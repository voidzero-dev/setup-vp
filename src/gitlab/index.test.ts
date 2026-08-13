import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { describe, expect, it, vi } from "vite-plus/test";
import { applyNodeManagerMode, isEntrypoint, main } from "./index.js";

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

describe("applyNodeManagerMode", () => {
  it("runs vp env off when SETUP_VP_NODE_MANAGER is false", () => {
    const runFn = vi.fn();

    applyNodeManagerMode({ SETUP_VP_NODE_MANAGER: "false" }, runFn);

    expect(runFn).toHaveBeenCalledWith("vp", ["env", "off"]);
  });

  it.each([{ SETUP_VP_NODE_MANAGER: "true" }, { SETUP_VP_NODE_MANAGER: "" }, {}])(
    "does nothing for %o",
    (env) => {
      const runFn = vi.fn();

      applyNodeManagerMode(env, runFn);

      expect(runFn).not.toHaveBeenCalled();
    },
  );

  it("rejects invalid values", () => {
    const runFn = vi.fn();

    expect(() => applyNodeManagerMode({ SETUP_VP_NODE_MANAGER: "off" }, runFn)).toThrow(
      'Invalid node-manager input: "off"',
    );
    expect(runFn).not.toHaveBeenCalled();
  });
});
