import { info } from "@actions/core";
import { exec } from "@actions/exec";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { installPnpm } from "./install-pnpm.js";
import type { Inputs } from "./types.js";

vi.mock("@actions/core", () => ({
  info: vi.fn(),
}));

vi.mock("@actions/exec", () => ({
  exec: vi.fn(),
}));

describe("installPnpm", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("installs pnpm globally when true", async () => {
    const inputs: Inputs = {
      version: "latest",
      runInstall: [{}],
      sfw: false,
      pnpm: true,
      cache: false,
      cacheSave: false,
    };
    await installPnpm(inputs);

    expect(info).toHaveBeenCalledWith("Installing pnpm globally...");
    expect(exec).toHaveBeenCalledWith("vp", ["install", "-g", "pnpm"]);
  });

  it("does not install pnpm globally when false", async () => {
    const inputs: Inputs = {
      version: "latest",
      runInstall: [{}],
      sfw: false,
      pnpm: false,
      cache: false,
      cacheSave: false,
    };
    await installPnpm(inputs);

    expect(info).not.toHaveBeenCalled();
    expect(exec).not.toHaveBeenCalled();
  });
});
