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
      version: "",
      versionFile: undefined,
      nodeVersion: undefined,
      nodeVersionFile: undefined,
      workingDirectory: undefined,
      runInstall: [],
      sfw: false,
      cache: false,
      cacheSave: false,
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

  it("should parse version-file input", () => {
    vi.mocked(getInput).mockImplementation((name) => {
      if (name === "version-file") return "package.json";
      return "";
    });
    vi.mocked(getBooleanInput).mockReturnValue(false);

    const inputs = getInputs();

    expect(inputs.versionFile).toBe("package.json");
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

  it("should parse cache-save input", () => {
    vi.mocked(getInput).mockReturnValue("");
    vi.mocked(getBooleanInput).mockImplementation((name) => {
      if (name === "cache-save") return true;
      return false;
    });

    const inputs = getInputs();

    expect(inputs.cacheSave).toBe(true);
  });

  it("should parse sfw input", () => {
    vi.mocked(getInput).mockReturnValue("");
    vi.mocked(getBooleanInput).mockImplementation((name) => {
      if (name === "sfw") return true;
      return false;
    });

    const inputs = getInputs();

    expect(inputs.sfw).toBe(true);
  });

  it("should parse node-version-file input", () => {
    vi.mocked(getInput).mockImplementation((name) => {
      if (name === "node-version-file") return ".nvmrc";
      return "";
    });
    vi.mocked(getBooleanInput).mockReturnValue(false);

    const inputs = getInputs();

    expect(inputs.nodeVersionFile).toBe(".nvmrc");
  });

  it("should parse node-manager as true", () => {
    vi.mocked(getInput).mockImplementation((name) => {
      if (name === "node-manager") return "true";
      return "";
    });
    vi.mocked(getBooleanInput).mockReturnValue(false);

    const inputs = getInputs();

    expect(inputs.nodeManager).toBe(true);
  });

  it("should parse node-manager as false", () => {
    vi.mocked(getInput).mockImplementation((name) => {
      if (name === "node-manager") return "false";
      return "";
    });
    vi.mocked(getBooleanInput).mockReturnValue(false);

    const inputs = getInputs();

    expect(inputs.nodeManager).toBe(false);
  });

  it("should leave node-manager undefined when unset", () => {
    vi.mocked(getInput).mockReturnValue("");
    vi.mocked(getBooleanInput).mockReturnValue(false);

    const inputs = getInputs();

    expect(inputs.nodeManager).toBeUndefined();
  });

  it("should reject invalid node-manager values", () => {
    vi.mocked(getInput).mockImplementation((name) => {
      if (name === "node-manager") return "off";
      return "";
    });
    vi.mocked(getBooleanInput).mockReturnValue(false);

    expect(() => getInputs()).toThrow('Invalid node-manager input: "off"');
  });

  it("should reject node-manager false combined with node-version", () => {
    vi.mocked(getInput).mockImplementation((name) => {
      if (name === "node-manager") return "false";
      if (name === "node-version") return "22";
      return "";
    });
    vi.mocked(getBooleanInput).mockReturnValue(false);

    expect(() => getInputs()).toThrow("node-manager: false cannot be combined");
  });

  it("should reject node-manager false combined with node-version-file", () => {
    vi.mocked(getInput).mockImplementation((name) => {
      if (name === "node-manager") return "false";
      if (name === "node-version-file") return ".nvmrc";
      return "";
    });
    vi.mocked(getBooleanInput).mockReturnValue(false);

    expect(() => getInputs()).toThrow("node-manager: false cannot be combined");
  });

  it("should allow node-manager true combined with node-version", () => {
    vi.mocked(getInput).mockImplementation((name) => {
      if (name === "node-manager") return "true";
      if (name === "node-version") return "22";
      return "";
    });
    vi.mocked(getBooleanInput).mockReturnValue(false);

    const inputs = getInputs();

    expect(inputs.nodeManager).toBe(true);
    expect(inputs.nodeVersion).toBe("22");
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

  it("should parse working-directory input", () => {
    vi.mocked(getInput).mockImplementation((name) => {
      if (name === "working-directory") return "web";
      return "";
    });
    vi.mocked(getBooleanInput).mockReturnValue(false);

    const inputs = getInputs();

    expect(inputs.workingDirectory).toBe("web");
  });
});
