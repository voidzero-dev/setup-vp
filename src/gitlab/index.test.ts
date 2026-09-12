import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { installVitePlus } from "../ci/install-viteplus.js";
import { run } from "../ci/process.js";
import { getCommandOutput } from "../ci/process.js";
import { applyEnvironmentModes, isEntrypoint, main } from "./index.js";

vi.mock("../ci/process.js", () => ({
  getCommandOutput: vi.fn(),
  run: vi.fn(),
  runWithOutput: vi.fn(),
}));
vi.mock("../ci/install-viteplus.js", () => ({ installVitePlus: vi.fn(async () => {}) }));

const directories: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("GitLab setup parity", () => {
  function fixture() {
    const root = mkdtempSync(path.join(tmpdir(), "setup-vp-gitlab-lifecycle-"));
    directories.push(root);
    mkdirSync(path.join(root, "app"));
    for (const name of [
      "VERSION",
      "VERSION_FILE",
      "NODE_VERSION",
      "NODE_VERSION_FILE",
      "PACKAGE_MANAGER",
      "NODE_MANAGER",
      "CACHE",
      "CACHE_SAVE",
      "REGISTRY_URL",
      "SCOPE",
      "SFW",
      "SFW_CACHE_DIR",
      "INSTALLED_VERSION",
      "CACHE_HIT",
    ])
      vi.stubEnv("SETUP_VP_" + name, "");
    vi.stubEnv("CI_PROJECT_DIR", root);
    vi.stubEnv("SETUP_VP_WORKING_DIRECTORY", "app");
    vi.stubEnv("SETUP_VP_RUN_INSTALL", "false");
    vi.stubEnv("SETUP_VP_ENV_FILE", path.join(root, "shell.env"));
    vi.stubEnv("SETUP_VP_ENV_FORMAT", "");
    vi.mocked(getCommandOutput).mockReturnValue("vp v0.3.1");
    return root;
  }

  it("resolves project pins and Node files before setup and exports only public dotenv outputs", async () => {
    const root = fixture();
    writeFileSync(
      path.join(root, "app/package.json"),
      JSON.stringify({ devDependencies: { "vite-plus": "0.3.1" } }),
    );
    writeFileSync(path.join(root, "app/.nvmrc"), "v22.15.0");
    vi.stubEnv("SETUP_VP_NODE_VERSION_FILE", ".nvmrc");
    await main();
    expect(installVitePlus).toHaveBeenCalledWith("0.3.1", expect.any(Object));
    expect(run).toHaveBeenCalledWith("vp", ["env", "use", "22.15.0"], {
      cwd: path.join(root, "app"),
    });
    expect(getCommandOutput).toHaveBeenLastCalledWith("vp", ["--version"], {
      cwd: path.join(root, "app"),
    });
    expect(readFileSync(path.join(root, ".setup-vp-outputs.env"), "utf8")).toBe(
      "SETUP_VP_INSTALLED_VERSION=0.3.1\nSETUP_VP_CACHE_HIT=false\n",
    );
    expect(readFileSync(path.join(root, "shell.env"), "utf8")).toContain(
      "export SETUP_VP_INSTALLED_VERSION='0.3.1'",
    );
  });

  it("gives explicit versions priority over version files", async () => {
    fixture();
    vi.stubEnv("SETUP_VP_VERSION", "0.3.2");
    vi.stubEnv("SETUP_VP_VERSION_FILE", "missing");
    vi.stubEnv("SETUP_VP_NODE_VERSION", "22");
    vi.stubEnv("SETUP_VP_NODE_VERSION_FILE", "missing");
    await main();
    expect(installVitePlus).toHaveBeenCalledWith("0.3.2", expect.any(Object));
    expect(run).toHaveBeenCalledWith("vp", ["env", "use", "22"], expect.any(Object));
  });

  it("rejects Node opt-out conflicts before installation", async () => {
    fixture();
    vi.stubEnv("SETUP_VP_NODE_MANAGER", "false");
    vi.stubEnv("SETUP_VP_NODE_VERSION_FILE", ".nvmrc");
    await expect(main()).rejects.toThrow("cannot be used with node-manager");
    expect(installVitePlus).not.toHaveBeenCalled();
  });
});

describe("GitLab entrypoint", () => {
  it("exports the GitLab runtime main function", () => {
    expect(main).toBeTypeOf("function");
  });

  it("matches relative argv paths against the resolved module URL", () => {
    const absolutePath = fileURLToPath(new URL("./index.ts", import.meta.url));
    const relativePath = path.relative(process.cwd(), absolutePath);

    expect(isEntrypoint(relativePath, pathToFileURL(absolutePath).href)).toBe(true);
  });
});

describe("applyEnvironmentModes", () => {
  it.each(["0.2.2", "0.3.0", "0.3.1", "0.4.0", "1.0.0"])(
    "disables only Node.js on Vite+ %s",
    (version) => {
      vi.mocked(getCommandOutput).mockReturnValue(`vp v${version}`);
      const runFn = vi.fn();

      applyEnvironmentModes({ SETUP_VP_NODE_MANAGER: "false" }, runFn);

      expect(runFn).toHaveBeenCalledWith(
        "vp",
        version === "0.2.2" || version === "0.3.0" ? ["env", "off"] : ["env", "off", "node"],
      );
    },
  );

  it.each([{ SETUP_VP_NODE_MANAGER: "true" }, { SETUP_VP_NODE_MANAGER: "" }, {}])(
    "leaves default environment modes unchanged for %o",
    (env) => {
      const runFn = vi.fn();
      vi.mocked(getCommandOutput).mockReturnValue("vp v0.3.1");

      applyEnvironmentModes(env, runFn);

      expect(runFn).not.toHaveBeenCalled();
    },
  );

  it("rejects invalid values", () => {
    const runFn = vi.fn();

    expect(() => applyEnvironmentModes({ SETUP_VP_NODE_MANAGER: "off" }, runFn)).toThrow(
      'Invalid node-manager input: "off"',
    );
    expect(runFn).not.toHaveBeenCalled();
  });
});

describe("package-manager modes", () => {
  it.each([
    [undefined, []],
    ["true", []],
    ["false", [["env", "off", "pm"]]],
    ["pnpm: true\nbun: false", [["env", "off", "bun"]]],
    [
      '{"npm":false,"yarn":false}',
      [
        ["env", "off", "npm"],
        ["env", "off", "yarn"],
      ],
    ],
  ])("applies %s independently of Node.js", (input, expected) => {
    vi.mocked(getCommandOutput).mockReturnValue("vp v0.3.1");
    const runFn = vi.fn();
    applyEnvironmentModes({ SETUP_VP_PACKAGE_MANAGER: input }, runFn);
    expect(runFn.mock.calls).toEqual(expected.map((args) => ["vp", args]));
  });

  it.each([undefined, "true", "false", "pnpm: true", "bun: false", "{}"])(
    "handles %s on older Vite+",
    (input) => {
      vi.mocked(getCommandOutput).mockReturnValue("vp v0.3.0");
      const runFn = vi.fn();
      const apply = () => applyEnvironmentModes({ SETUP_VP_PACKAGE_MANAGER: input }, runFn);
      if (input === undefined) apply();
      else expect(apply).toThrow("package-manager configuration requires Vite+ 0.3.1 or newer");
      expect(runFn).not.toHaveBeenCalled();
    },
  );
});
