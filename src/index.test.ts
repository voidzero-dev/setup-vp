import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("@actions/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@actions/core")>();
  return {
    ...actual,
    getState: vi.fn(() => "true"),
    info: vi.fn(),
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

import { info } from "@actions/core";
import { saveCache } from "./cache-save.js";
import { runPost } from "./index.js";
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
