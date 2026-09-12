import { describe, expect, it, vi } from "vite-plus/test";
import { parseRunInstall, runInstall } from "./run-install.js";

describe("portable installs", () => {
  it("parses YAML comments, anchors, quoted escapes and empty arguments", () => {
    expect(
      parseRunInstall(`- &install
  cwd: "apps/web"
  args: ["--filter", "a\\"b", 'it''s', ""] # comment
- *install
`),
    ).toEqual(
      Array.from({ length: 2 }, () => ({ cwd: "apps/web", args: ["--filter", 'a"b', "it's", ""] })),
    );
    expect(parseRunInstall("True")).toEqual([{}]);
    expect(parseRunInstall("False")).toEqual([]);
    expect(() => parseRunInstall("args: [true]")).toThrow("array of strings");
  });

  it("warms PowerShell and retries the sfw command-lookup failure once", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ exitCode: 1, stdout: "", stderr: "Command 'vp' not found in PATH" })
      .mockRejectedValueOnce(new Error("warm-up failed"))
      .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" });
    await runInstall([{}], "/project", "sfw", {}, { platform: "win32", execute });
    expect(execute.mock.calls.map((call) => call[0])).toEqual(["sfw", "powershell.exe", "sfw"]);
  });

  it("runs later entries, aggregates failures, and never retries ordinary install errors", async () => {
    const execute = vi
      .fn()
      .mockResolvedValue({ exitCode: 1, stdout: "", stderr: "lockfile mismatch" });
    await expect(
      runInstall([{ cwd: "a" }, { cwd: "b" }], "/project", "sfw", {}, { execute }),
    ).rejects.toThrow(/cwd:.*a[\s\S]*cwd:.*b/);
    expect(execute).toHaveBeenCalledTimes(2);
  });
});
