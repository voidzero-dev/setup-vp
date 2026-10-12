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
    taskCache: false,
    taskCacheSave: true,
  }),
}));
vi.mock("./cache-save.js", () => ({
  saveCache: vi.fn(),
}));
vi.mock("./task-cache-restore.js", () => ({
  restoreTaskCache: vi.fn(),
}));
vi.mock("./task-cache-save.js", () => ({
  saveTaskCache: vi.fn(),
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
import { restoreTaskCache } from "./task-cache-restore.js";
import { saveTaskCache } from "./task-cache-save.js";
import { resolveVitePlusVersion } from "./version-file.js";
import type { Inputs } from "./types.js";

const mockedInfo = vi.mocked(info);
const mockedSaveCache = vi.mocked(saveCache);
const mockedRestoreTaskCache = vi.mocked(restoreTaskCache);
const mockedSaveTaskCache = vi.mocked(saveTaskCache);

const inputs = (
  cache: boolean,
  cacheSave: boolean,
  taskCache = false,
  taskCacheSave = true,
): Inputs => ({
  version: "",
  runInstall: [],
  sfw: false,
  cache,
  cacheSave,
  taskCache,
  taskCacheSave,
});

describe("runMain sfw", () => {
  it("passes the selected sfw executable to the install runner", async () => {
    vi.mocked(resolveVitePlusVersion).mockReturnValue("latest");
    const command = { executable: "/trusted/sfw", sfw: true };
    vi.mocked(setupSfw).mockResolvedValue(command);
    const requested = { ...inputs(false, true), sfw: true, runInstall: [{}] };

    await runMain(requested);

    expect(runViteInstall).toHaveBeenCalledWith(requested, command);
  });

  it("passes the resolved preview version to sfw setup and installs without sfw", async () => {
    const version = "0.0.0-commit.7d848b3da1987fa60b4cf18487fcc36a2a697e94";
    vi.mocked(resolveVitePlusVersion).mockReturnValue(version);
    vi.mocked(setupSfw).mockResolvedValue({ executable: "vp", sfw: false });
    const requested = { ...inputs(false, true), sfw: true, runInstall: [{}] };

    await runMain(requested);

    expect(installVitePlus).toHaveBeenCalledWith({ ...requested, version });
    expect(setupSfw).toHaveBeenCalledWith({ ...requested, version });
    expect(runViteInstall).toHaveBeenCalledWith(requested, { executable: "vp", sfw: false });
  });
});

describe("runMain task cache", () => {
  it("restores the task cache when task caching is enabled", async () => {
    vi.mocked(resolveVitePlusVersion).mockReturnValue("latest");
    vi.mocked(setupSfw).mockResolvedValue({ executable: "vp", sfw: false });
    const requested = inputs(false, true, true);

    await runMain(requested);

    expect(mockedRestoreTaskCache).toHaveBeenCalledWith(requested);
  });

  it("skips the task cache restore when task caching is disabled", async () => {
    vi.mocked(resolveVitePlusVersion).mockReturnValue("latest");
    vi.mocked(setupSfw).mockResolvedValue({ executable: "vp", sfw: false });

    await runMain(inputs(false, true));

    expect(mockedRestoreTaskCache).not.toHaveBeenCalled();
  });
});

describe("runPost", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips silently when caching is disabled", async () => {
    await runPost(inputs(false, true, false));

    expect(mockedSaveCache).not.toHaveBeenCalled();
    expect(mockedSaveTaskCache).not.toHaveBeenCalled();
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

  it("saves the task cache independently of the dep cache", async () => {
    await runPost(inputs(false, true, true));

    expect(mockedSaveCache).not.toHaveBeenCalled();
    expect(mockedSaveTaskCache).toHaveBeenCalledOnce();
    expect(mockedInfo).not.toHaveBeenCalled();
  });

  it("saves the task cache after dep cache when task caching is enabled", async () => {
    await runPost(inputs(true, true, true));

    expect(mockedSaveCache).toHaveBeenCalledOnce();
    expect(mockedSaveTaskCache).toHaveBeenCalledOnce();
  });

  it("skips the task cache save when task caching is disabled", async () => {
    await runPost(inputs(true, true));

    expect(mockedSaveCache).toHaveBeenCalledOnce();
    expect(mockedSaveTaskCache).not.toHaveBeenCalled();
  });

  it("logs and skips the task cache save when task cache saving is disabled", async () => {
    await runPost(inputs(true, true, true, false));

    expect(mockedSaveCache).toHaveBeenCalledOnce();
    expect(mockedSaveTaskCache).not.toHaveBeenCalled();
    expect(mockedInfo).toHaveBeenCalledWith(
      "Task cache saving is disabled. Skipping task cache save.",
    );
  });

  it("skips the task cache save when task cache saving is disabled and caching is off", async () => {
    await runPost(inputs(false, true, true, false));

    expect(mockedSaveTaskCache).not.toHaveBeenCalled();
    expect(mockedInfo).toHaveBeenCalledWith(
      "Task cache saving is disabled. Skipping task cache save.",
    );
  });
});
