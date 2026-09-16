import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("@actions/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@actions/core")>();
  return {
    ...actual,
    getState: vi.fn(() => "true"),
    info: vi.fn(),
    saveState: vi.fn(),
    setOutput: vi.fn(),
  };
});
vi.mock("./inputs.js", () => ({
  getInputs: () => ({
    version: "",
    runInstall: [],
    sfw: false,
    cache: false,
    cacheSave: true,
  }),
}));
vi.mock("./cache-save.js", () => ({
  saveCache: vi.fn(),
}));
vi.mock("@actions/exec", () => ({
  exec: vi.fn(),
  getExecOutput: vi.fn(async () => ({ stdout: "vp v0.3.2" })),
}));
vi.mock("./install-viteplus.js", () => ({ installVitePlus: vi.fn() }));
vi.mock("./install-sfw.js", () => ({ setupSfw: vi.fn() }));
vi.mock("./run-install.js", () => ({ runViteInstall: vi.fn() }));
vi.mock("./auth.js", () => ({
  configAuthentication: vi.fn(),
  propagateProjectNpmrcAuth: vi.fn(),
}));
vi.mock("./version-file.js", () => ({ resolveVitePlusVersion: vi.fn() }));

import { info } from "@actions/core";
import { saveCache } from "./cache-save.js";
import { runMain, runPost } from "./index.js";
import { installVitePlus } from "./install-viteplus.js";
import { setupSfw } from "./install-sfw.js";
import { runViteInstall } from "./run-install.js";
import { resolveVitePlusVersion } from "./version-file.js";
import type { Inputs } from "./types.js";

const mockedInfo = vi.mocked(info);
const mockedSaveCache = vi.mocked(saveCache);

const inputs = (cache: boolean, cacheSave: boolean): Inputs => ({
  version: "",
  runInstall: [],
  sfw: false,
  cache,
  cacheSave,
});

describe("runMain sfw", () => {
  it("passes the resolved preview version to sfw setup and installs without sfw", async () => {
    const version = "0.0.0-commit.7d848b3da1987fa60b4cf18487fcc36a2a697e94";
    vi.mocked(resolveVitePlusVersion).mockReturnValue(version);
    vi.mocked(setupSfw).mockResolvedValue(false);
    const requested = { ...inputs(false, true), sfw: true, runInstall: [{}] };

    await runMain(requested);

    expect(installVitePlus).toHaveBeenCalledWith({ ...requested, version });
    expect(setupSfw).toHaveBeenCalledWith({ ...requested, version });
    expect(runViteInstall).toHaveBeenCalledWith({ ...requested, sfw: false });
  });
});

describe("runPost", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips silently when caching is disabled", async () => {
    await runPost(inputs(false, true));

    expect(mockedSaveCache).not.toHaveBeenCalled();
    expect(mockedInfo).not.toHaveBeenCalled();
  });

  it("logs and skips when cache saving is disabled", async () => {
    await runPost(inputs(true, false));

    expect(mockedSaveCache).not.toHaveBeenCalled();
    expect(mockedInfo).toHaveBeenCalledWith("Cache saving is disabled. Skipping cache save.");
  });

  it("saves the cache when caching and cache saving are enabled", async () => {
    await runPost(inputs(true, true));

    expect(mockedSaveCache).toHaveBeenCalledOnce();
    expect(mockedInfo).not.toHaveBeenCalled();
  });
});
