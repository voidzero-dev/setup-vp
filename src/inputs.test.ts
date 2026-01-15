import { describe, it, expect, beforeEach, afterEach, vi } from "vite-plus/test";
import { getInput, getBooleanInput } from "@actions/core";
import { getInputs } from "./inputs.js";

// Mock @actions/core
vi.mock("@actions/core", () => ({
  getInput: vi.fn(),
  getBooleanInput: vi.fn(),
}));

describe("getInputs", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("should return default values when no inputs provided", () => {
    vi.mocked(getInput).mockReturnValue("");
    vi.mocked(getBooleanInput).mockReturnValue(false);

    const inputs = getInputs();

    expect(inputs).toEqual({
      version: "latest",
      runInstall: [],
      cache: false,
      cacheDependencyPath: undefined,
    });
  });

  it("should parse version input", () => {
    vi.mocked(getInput).mockImplementation((name) => {
      if (name === "version") return "1.2.3";
      return "";
    });
    vi.mocked(getBooleanInput).mockReturnValue(false);

    const inputs = getInputs();

    expect(inputs.version).toBe("1.2.3");
  });

  it("should parse run-install as true", () => {
    vi.mocked(getInput).mockImplementation((name) => {
      if (name === "run-install") return "true";
      return "";
    });
    vi.mocked(getBooleanInput).mockReturnValue(false);

    const inputs = getInputs();

    expect(inputs.runInstall).toEqual([{}]);
  });

  it("should parse run-install as false", () => {
    vi.mocked(getInput).mockImplementation((name) => {
      if (name === "run-install") return "false";
      return "";
    });
    vi.mocked(getBooleanInput).mockReturnValue(false);

    const inputs = getInputs();

    expect(inputs.runInstall).toEqual([]);
  });

  it("should parse run-install as YAML object", () => {
    vi.mocked(getInput).mockImplementation((name) => {
      if (name === "run-install") return "cwd: ./packages/app\nargs:\n  - --frozen-lockfile";
      return "";
    });
    vi.mocked(getBooleanInput).mockReturnValue(false);

    const inputs = getInputs();

    expect(inputs.runInstall).toEqual([{ cwd: "./packages/app", args: ["--frozen-lockfile"] }]);
  });

  it("should parse run-install as YAML array", () => {
    vi.mocked(getInput).mockImplementation((name) => {
      if (name === "run-install") return "- cwd: ./app\n- cwd: ./lib";
      return "";
    });
    vi.mocked(getBooleanInput).mockReturnValue(false);

    const inputs = getInputs();

    expect(inputs.runInstall).toEqual([{ cwd: "./app" }, { cwd: "./lib" }]);
  });

  it("should parse cache input", () => {
    vi.mocked(getInput).mockReturnValue("");
    vi.mocked(getBooleanInput).mockImplementation((name) => {
      if (name === "cache") return true;
      return false;
    });

    const inputs = getInputs();

    expect(inputs.cache).toBe(true);
  });

  it("should parse cache-dependency-path input", () => {
    vi.mocked(getInput).mockImplementation((name) => {
      if (name === "cache-dependency-path") return "custom-lock.yaml";
      return "";
    });
    vi.mocked(getBooleanInput).mockReturnValue(false);

    const inputs = getInputs();

    expect(inputs.cacheDependencyPath).toBe("custom-lock.yaml");
  });
});
