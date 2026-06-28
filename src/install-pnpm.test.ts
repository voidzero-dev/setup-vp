import { describe, it, expect, afterEach, vi } from "vite-plus/test";
import { exec } from "@actions/exec";
import { info } from "@actions/core";
import { installPnpm } from "./install-pnpm.js";
import type { Inputs } from "./types.js";

vi.mock("@actions/core", () => ({
  info: vi.fn(),
}));

vi.mock("@actions/exec", () => ({
  exec: vi.fn(),
}));

const baseInputs: Inputs = {
  version: "latest",
  nodeVersion: undefined,
  nodeVersionFile: undefined,
  workingDirectory: undefined,
  runInstall: [],
  sfw: false,
  installPnpm: false,
  pnpmVersion: undefined,
  cache: false,
  cacheDependencyPath: undefined,
  registryUrl: undefined,
  scope: undefined,
};

describe("installPnpm", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("does nothing when install-pnpm is disabled", async () => {
    await installPnpm(baseInputs);

    expect(exec).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
  });

  it("installs latest pnpm globally by default", async () => {
    await installPnpm({ ...baseInputs, installPnpm: true });

    expect(info).toHaveBeenCalledWith("Installing pnpm@latest globally...");
    expect(exec).toHaveBeenCalledWith("npm", ["install", "--global", "pnpm@latest"]);
  });

  it("installs the requested pnpm version globally", async () => {
    await installPnpm({ ...baseInputs, installPnpm: true, pnpmVersion: "10.34.3" });

    expect(info).toHaveBeenCalledWith("Installing pnpm@10.34.3 globally...");
    expect(exec).toHaveBeenCalledWith("npm", ["install", "--global", "pnpm@10.34.3"]);
  });
});
