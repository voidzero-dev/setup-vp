import { spawn, execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir, release } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";

const baselineRef = "ad00cb8c5ec49bb6a15056affa78108a3f3c4854";
const actionRef = "25c45dae5483c264bd5137f76ee45d65375634ef";
const previewRef = process.env.PREVIEW_SHA;
if (!/^[a-f0-9]{40}$/.test(previewRef || ""))
  throw new Error("PREVIEW_SHA must be a full commit SHA");
const projectNode = "22.23.1";
const previewVersion = `0.0.0-commit.${previewRef}`;
const sample = Number(process.env.BENCHMARK_SAMPLE || 0);
const orders = [
  ["release", "preview-lts", "preview-project"],
  ["preview-project", "preview-lts", "release"],
  ["preview-lts", "release", "preview-project"],
  ["preview-project", "release", "preview-lts"],
  ["release", "preview-project", "preview-lts"],
  ["preview-lts", "preview-project", "release"],
];
const order = process.argv[2] ? process.argv[2].split(",") : orders[sample % orders.length];
const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.resolve(
  process.env.BENCHMARK_OUTPUT || path.join(workspace, "benchmark-results"),
);
await mkdir(outputDir, { recursive: true });
const baselineBundle = path.join(outputDir, "baseline.mjs");
const response = await fetch(
  `https://raw.githubusercontent.com/voidzero-dev/setup-vp/${baselineRef}/dist/index.mjs`,
);
if (!response.ok) throw new Error(`Baseline download: ${response.status}`);
await writeFile(baselineBundle, await response.text());
const metadata = {
  baselineRef,
  actionRef,
  previewRef,
  projectNode,
  sample,
  order,
  runner: process.env.RUNNER_OS || process.platform,
  platform: process.platform,
  arch: process.arch,
  osRelease: release(),
  imageVersion: process.env.ImageVersion,
  actionNode: process.version,
  startedAt: new Date().toISOString(),
};
const results = [];

for (const variant of order) {
  if (!["release", "preview-lts", "preview-project"].includes(variant))
    throw new Error(`Unknown variant ${variant}`);
  const root = await mkdtemp(
    path.join(process.env.RUNNER_TEMP || tmpdir(), `vp-benchmark-${variant}-`),
  );
  const project = path.join(root, "project");
  const home = path.join(root, "vp");
  await mkdir(project);
  await writeFile(
    path.join(project, "package.json"),
    '{"name":"bootstrap-benchmark","private":true}\n',
  );
  await writeFile(path.join(project, ".node-version"), `${projectNode}\n`);
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !/^(VP_|VITE_PLUS_|INPUT_|STATE_)/.test(name)),
  );
  Object.assign(env, {
    CI: "true",
    GITHUB_ACTIONS: "true",
    GITHUB_WORKSPACE: project,
    RUNNER_TEMP: root,
    INPUT_VERSION: variant === "release" ? "1.3.0" : previewVersion,
    "INPUT_NODE-VERSION-FILE": ".node-version",
    "INPUT_WORKING-DIRECTORY": project,
    "INPUT_RUN-INSTALL": "false",
    INPUT_CACHE: "false",
    "INPUT_CACHE-SAVE": "false",
    INPUT_SFW: "false",
    VP_HOME: home,
    VP_SELF_SETUP_NO_MODIFY_PATH: "1",
    npm_config_store_dir: path.join(root, "pnpm-store"),
    npm_config_cache: path.join(root, "npm-cache"),
    NPM_CONFIG_REGISTRY: "https://registry.npmjs.org",
  });
  for (const kind of ["STATE", "OUTPUT", "ENV", "PATH"]) {
    env[`GITHUB_${kind}`] = path.join(root, kind.toLowerCase());
    await writeFile(env[`GITHUB_${kind}`], "");
  }
  const bundle =
    variant === "preview-project" ? path.join(workspace, "dist/index.mjs") : baselineBundle;
  const events = [];
  const markers = {};
  const started = performance.now();
  const child = spawn(process.execPath, [bundle], {
    cwd: project,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const patterns = {
    installerStart: /^\[command\]/,
    prepareStart: /Preparing Node\.js and pnpm/,
    dependenciesStart: /Installing dependencies\.\.\./,
    dependenciesEnd: /Dependencies installed\./,
    installerEnd: /Vite\+ setup complete\./,
    activateStart: /Setting up Node\.js .*via vp env use/,
    activateEnd: /^Using Node\.js /,
  };
  function capture(stream, channel) {
    let pending = "";
    function line(value) {
      const ms = performance.now() - started;
      const clean = stripVTControlCharacters(value).trim();
      events.push({ ms, channel, text: clean });
      for (const [name, pattern] of Object.entries(patterns)) {
        if (markers[name] === undefined && pattern.test(clean)) markers[name] = ms;
      }
    }
    stream.on("data", (data) => {
      const lines = (pending + data.toString()).split(/\r?\n/);
      pending = lines.pop();
      for (const value of lines) line(value);
    });
    stream.on("end", () => {
      if (pending) line(pending);
    });
  }
  capture(child.stdout, "stdout");
  capture(child.stderr, "stderr");
  const exitCode = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  const totalMs = performance.now() - started;
  const elapsed = (start, end) =>
    markers[start] !== undefined && markers[end] !== undefined
      ? markers[end] - markers[start]
      : null;
  const result = {
    variant,
    exitCode,
    totalMs,
    markers,
    installerMs: elapsed("installerStart", "installerEnd"),
    prepareRuntimeMs: elapsed("prepareStart", "dependenciesStart"),
    dependenciesMs: elapsed("dependenciesStart", "dependenciesEnd"),
    activateNodeMs: elapsed("activateStart", "activateEnd"),
  };
  await writeFile(
    path.join(outputDir, `${variant}.jsonl`),
    events.map((event) => JSON.stringify(event)).join("\n"),
  );
  await writeFile(
    path.join(outputDir, `${variant}.log`),
    events.map((event) => `${event.ms.toFixed(1)}ms ${event.channel}: ${event.text}`).join("\n"),
  );
  try {
    if (exitCode !== 0) throw new Error(`Action exited ${exitCode}`);
    result.pnpmStoreEntries = await readdir(path.join(root, "pnpm-store"));
    const entries = await readdir(path.join(home, "js_runtime/node"), { withFileTypes: true });
    result.nodeVersions = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    if (!result.nodeVersions.includes(projectNode))
      throw new Error("Project Node was not installed");
    const expected = variant === "preview-project" ? 1 : 2;
    if (result.nodeVersions.length !== expected)
      throw new Error(`Expected ${expected} Node versions, found ${result.nodeVersions}`);
    const node = path.join(
      home,
      "js_runtime/node",
      projectNode,
      process.platform === "win32" ? "node.exe" : "bin/node",
    );
    result.verifiedNode = execFileSync(node, ["--version"], { encoding: "utf8" }).trim();
    if (result.verifiedNode !== `v${projectNode}`) throw new Error("Wrong project Node binary");
    const outputs = await readFile(env.GITHUB_OUTPUT, "utf8");
    const expectedVersion = variant === "release" ? "1.3.0" : previewVersion;
    if (!outputs.includes(expectedVersion)) throw new Error("Unexpected installed Vite+ version");
    for (const marker of Object.keys(patterns)) {
      if (markers[marker] === undefined) throw new Error(`Missing timing marker: ${marker}`);
    }
  } catch (error) {
    result.error = String(error);
  }
  results.push(result);
  await writeFile(
    path.join(outputDir, "results.json"),
    JSON.stringify({ ...metadata, results }, null, 2),
  );
  console.log(JSON.stringify(result));
  if (result.error) throw new Error(`${variant}: ${result.error}; see ${outputDir}`);
}
if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFile } = await import("node:fs/promises");
  await appendFile(
    process.env.GITHUB_STEP_SUMMARY,
    [
      `### ${metadata.runner} ${metadata.arch}, sample ${sample + 1}`,
      "",
      "| Variant | Total | Installer | Node + pnpm prep | Dependencies | Project Node activation | Node versions |",
      "| --- | ---: | ---: | ---: | ---: | ---: | --- |",
      ...results.map(
        (r) =>
          `| ${r.variant} | ${(r.totalMs / 1000).toFixed(3)}s | ${(r.installerMs / 1000).toFixed(3)}s | ${(r.prepareRuntimeMs / 1000).toFixed(3)}s | ${(r.dependenciesMs / 1000).toFixed(3)}s | ${(r.activateNodeMs / 1000).toFixed(3)}s | ${r.nodeVersions.join(", ")} |`,
      ),
      "",
    ].join("\n"),
  );
}
