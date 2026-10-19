import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { stripVTControlCharacters } from "node:util";

const repository = fileURLToPath(new URL("../../", import.meta.url));
const action = path.join(repository, "dist/index.mjs");
const sample = Number(process.env.BENCHMARK_SAMPLE || 0);
const preview = process.env.BENCHMARK_PREVIEW_SHA || "";
if (preview && !/^[a-f0-9]{40}$/.test(preview))
  throw new Error("Toolchain benchmarks require a full preview commit SHA.");
const version = preview ? `0.0.0-commit.${preview}` : "1.3.0";
const nodeVersion = "22.23.1";
// A unique absolute root partitions the cache identity. The miss and hit use
// the same paths; all installation and package caches are removed between them.
const id = `${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}-${sample}`;
const root = path.join(homedir(), ".setup-vp-benchmark", id);
const output = path.join(repository, "benchmark-results", `toolchain-${sample}`);
await mkdir(output, { recursive: true });
const results = [];

const COMMAND_FIELD = /^([^\r\n<]+)<<([^\r\n]+)\r?\n([\s\S]*?)\r?\n\2(?:\r?\n|$)/gm;
async function commandFile(file) {
  return Object.fromEntries(
    Array.from((await readFile(file, "utf8")).matchAll(COMMAND_FIELD), (match) => [
      match[1],
      match[3],
    ]),
  );
}

async function execute(env, project, label) {
  const events = [];
  const started = performance.now();
  const child = spawn(process.execPath, [action], {
    env,
    cwd: project,
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const [channel, stream] of [
    ["stdout", child.stdout],
    ["stderr", child.stderr],
  ]) {
    let pending = "";
    stream.on("data", (chunk) => {
      const lines = (pending + chunk).split(/\r?\n/);
      pending = lines.pop();
      for (const line of lines)
        events.push({
          ms: performance.now() - started,
          channel,
          text: stripVTControlCharacters(line).trim(),
        });
    });
    stream.on("end", () => {
      if (pending)
        events.push({
          ms: performance.now() - started,
          channel,
          text: stripVTControlCharacters(pending).trim(),
        });
    });
  }
  const code = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  const elapsedMs = performance.now() - started;
  await writeFile(
    path.join(output, `${label}.jsonl`),
    events.map((event) => JSON.stringify(event)).join("\n"),
  );
  if (code !== 0) {
    process.stdout.write(events.map((event) => event.text).join("\n"));
    throw new Error(`${label} exited ${code}`);
  }
  return elapsedMs;
}

async function prepare(label) {
  const directory = path.join(root, label === "uncached" ? "baseline" : "cached");
  await rm(directory, { recursive: true, force: true });
  const home = path.join(directory, "vp");
  const project = path.join(directory, "project");
  await mkdir(project, { recursive: true });
  await writeFile(
    path.join(project, "package.json"),
    '{"name":"toolchain-benchmark","private":true}\n',
  );
  await writeFile(path.join(project, ".node-version"), `${nodeVersion}\n`);
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !/^(VP_|VITE_PLUS_|INPUT_|STATE_|npm_config_|NPM_CONFIG_|pnpm_config_)/.test(key),
    ),
  );
  Object.assign(env, {
    CI: "true",
    GITHUB_ACTIONS: "true",
    GITHUB_WORKSPACE: project,
    RUNNER_TEMP: directory,
    INPUT_VERSION: version,
    "INPUT_NODE-VERSION-FILE": ".node-version",
    "INPUT_WORKING-DIRECTORY": project,
    "INPUT_RUN-INSTALL": "false",
    INPUT_CACHE: "false",
    "INPUT_CACHE-TOOLCHAIN": String(label !== "uncached"),
    "INPUT_CACHE-SAVE": "true",
    INPUT_SFW: "false",
    VP_HOME: home,
    VP_SELF_SETUP_NO_MODIFY_PATH: "1",
    npm_config_store_dir: path.join(directory, "store"),
    npm_config_cache: path.join(directory, "npm-cache"),
    npm_config_cache_dir: path.join(directory, "pnpm-cache"),
    npm_config_state_dir: path.join(directory, "pnpm-state"),
    NPM_CONFIG_REGISTRY: "https://registry.npmjs.org",
    XDG_CACHE_HOME: path.join(directory, "xdg-cache"),
    XDG_DATA_HOME: path.join(directory, "xdg-data"),
    XDG_STATE_HOME: path.join(directory, "xdg-state"),
  });
  for (const kind of ["user", "global"]) {
    const file = path.join(directory, `${kind}.npmrc`);
    await writeFile(file, "");
    env[`npm_config_${kind}config`] = file;
  }
  for (const kind of ["STATE", "OUTPUT", "ENV", "PATH"]) {
    const file = path.join(directory, kind.toLowerCase());
    await writeFile(file, "");
    env[`GITHUB_${kind}`] = file;
  }
  return { directory, home, project, env };
}

async function verifyInstallation(home, project, env) {
  const windows = process.platform === "win32";
  const node = path.join(
    home,
    "js_runtime/node",
    nodeVersion,
    ...(windows ? ["node.exe"] : ["bin", "node"]),
  );
  const actualNode = execFileSync(node, ["--version"], { env, encoding: "utf8" }).trim();
  assert.equal(actualNode, `v${nodeVersion}`, "Installed Node version");
  const payload = await realpath(path.join(home, "current"));
  const manifest = JSON.parse(
    await readFile(path.join(payload, "node_modules/vite-plus/package.json"), "utf8"),
  );
  assert.equal(manifest.version, version, "Installed Vite+ version");
  execFileSync(
    node,
    [
      "--input-type=commonjs",
      "-e",
      "require(process.argv[1])",
      path.join(payload, "node_modules/vite-plus/binding/index.cjs"),
    ],
    { env, cwd: project, stdio: "pipe" },
  );
  execFileSync(path.join(home, "bin", windows ? "vp.exe" : "vp"), ["fmt", "--version"], {
    env,
    cwd: project,
    stdio: "pipe",
  });
}

async function run(label) {
  const { directory, home, project, env } = await prepare(label);
  const setupMs = await execute(env, project, `${label}-setup`);
  const outputs = await commandFile(env.GITHUB_OUTPUT);
  const state = await commandFile(env.GITHUB_STATE);
  const expectedHit = label === "hit";
  assert.equal(outputs["toolchain-cache-hit"] === "true", expectedHit, `${label}: cache hit`);
  await verifyInstallation(home, project, env);
  for (const [key, value] of Object.entries(state)) env[`STATE_${key}`] = value;
  const postMs = await execute(env, project, `${label}-post`);
  if (label === "miss") {
    const postLog = await readFile(path.join(output, `${label}-post.jsonl`), "utf8");
    assert.ok(postLog.includes("Toolchain cache saved:"), "The miss must save a real remote cache");
  }
  const runtimes = (await readdir(path.join(home, "js_runtime/node"), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  results.push({
    label,
    setupMs,
    postMs,
    combinedMs: setupMs + postMs,
    cacheHit: expectedHit,
    cacheKey: state.TOOLCHAIN_CACHE_PLAN ? JSON.parse(state.TOOLCHAIN_CACHE_PLAN).key : null,
    nodeVersions: runtimes,
    nativeBindingAndFormatterVerified: true,
  });
  await writeFile(
    path.join(output, "results.json"),
    JSON.stringify(
      {
        actionCommit: process.env.GITHUB_SHA,
        version,
        nodeVersion,
        platform: process.platform,
        arch: process.arch,
        runnerImage: process.env.ImageVersion,
        sample,
        results,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify(results.at(-1)));
  await rm(directory, { recursive: true, force: true });
}

try {
  for (const label of sample % 2 ? ["miss", "hit", "uncached"] : ["uncached", "miss", "hit"])
    await run(label);
} finally {
  await rm(root, { recursive: true, force: true });
}
