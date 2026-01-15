import { describe, it, expect } from "vite-plus/test";
import { RunInstallSchema, RunInstallInputSchema } from "./types.js";

describe("RunInstallSchema", () => {
  it("should accept empty object", () => {
    const result = RunInstallSchema.parse({});
    expect(result).toEqual({});
  });

  it("should accept object with cwd", () => {
    const result = RunInstallSchema.parse({ cwd: "./packages/app" });
    expect(result).toEqual({ cwd: "./packages/app" });
  });

  it("should accept object with args", () => {
    const result = RunInstallSchema.parse({ args: ["--frozen-lockfile"] });
    expect(result).toEqual({ args: ["--frozen-lockfile"] });
  });

  it("should accept object with cwd and args", () => {
    const result = RunInstallSchema.parse({
      cwd: "./packages/app",
      args: ["--frozen-lockfile", "--prefer-offline"],
    });
    expect(result).toEqual({
      cwd: "./packages/app",
      args: ["--frozen-lockfile", "--prefer-offline"],
    });
  });

  it("should reject invalid cwd type", () => {
    expect(() => RunInstallSchema.parse({ cwd: 123 })).toThrow();
  });

  it("should reject invalid args type", () => {
    expect(() => RunInstallSchema.parse({ args: "not-an-array" })).toThrow();
  });
});

describe("RunInstallInputSchema", () => {
  it("should accept null", () => {
    const result = RunInstallInputSchema.parse(null);
    expect(result).toBeNull();
  });

  it("should accept boolean true", () => {
    const result = RunInstallInputSchema.parse(true);
    expect(result).toBe(true);
  });

  it("should accept boolean false", () => {
    const result = RunInstallInputSchema.parse(false);
    expect(result).toBe(false);
  });

  it("should accept single object", () => {
    const result = RunInstallInputSchema.parse({ cwd: "./app" });
    expect(result).toEqual({ cwd: "./app" });
  });

  it("should accept array of objects", () => {
    const result = RunInstallInputSchema.parse([
      { cwd: "./packages/app" },
      { cwd: "./packages/lib", args: ["--frozen-lockfile"] },
    ]);
    expect(result).toEqual([
      { cwd: "./packages/app" },
      { cwd: "./packages/lib", args: ["--frozen-lockfile"] },
    ]);
  });

  it("should accept empty array", () => {
    const result = RunInstallInputSchema.parse([]);
    expect(result).toEqual([]);
  });
});
