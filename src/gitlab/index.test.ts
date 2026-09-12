import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { describe, expect, it, vi } from "vite-plus/test";
import { getCommandOutput } from "../ci/process.js";
import { applyEnvironmentModes, isEntrypoint, main } from "./index.js";

vi.mock("../ci/process.js", () => ({ getCommandOutput: vi.fn(), run: vi.fn() }));

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
