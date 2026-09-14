import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { commandPath, getCommandOutput, run, runWithOutput } from "./process.js";

const directories: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("portable process helpers", () => {
  it("retains native executable output and failures", async () => {
    expect(getCommandOutput(process.execPath, ["-p", "'output'"])).toBe("output");
    expect(getCommandOutput(process.execPath, ["-e", "process.exit(7)"])).toBeUndefined();
    expect(() => run(process.execPath, ["-e", "process.exit(7)"])).toThrow("exited with code 7");
    expect(await runWithOutput(process.execPath, ["-e", "process.exit(7)"])).toEqual({
      exitCode: 7,
      stdout: "",
      stderr: "",
    });
  });

  it.skipIf(process.platform !== "win32").each(["bin with spaces", "node_modules/.bin"])(
    "runs a vp.cmd shim from %s through every helper",
    async (binName) => {
      const root = mkdtempSync(path.join(tmpdir(), "setup-vp-cmd-"));
      directories.push(root);
      const bin = path.join(root, binName);
      const output = path.join(root, "arguments.json");
      mkdirSync(bin, { recursive: true });
      const invocation = `"${process.execPath}" "%~dp0record.cjs" %*`;
      writeFileSync(
        path.join(bin, "vp.cmd"),
        // npm/pnpm shims use a conditional block, which adds another cmd.exe
        // parsing pass. Cover that layout as well as a plain standalone shim.
        binName === "node_modules/.bin"
          ? `@echo off\r\n@if exist "${process.execPath}" (\r\n  ${invocation}\r\n)\r\n`
          : `@echo off\r\n${invocation}\r\n`,
      );
      writeFileSync(
        path.join(bin, "record.cjs"),
        `
const fs = require('node:fs');
fs.writeFileSync(process.env.SETUP_VP_TEST_ARGS, JSON.stringify(process.argv.slice(2)));
console.log('vp v0.3.1');
process.exit(Number(process.env.SETUP_VP_TEST_EXIT || 0));
`,
      );
      vi.stubEnv("PATH", `${bin}${path.delimiter}${process.env.PATH || ""}`);
      vi.stubEnv("PATHEXT", ".COM;.EXE;.BAT;.CMD");
      vi.stubEnv("SETUP_VP_TEST_ARGS", output);
      vi.stubEnv("SETUP_VP_TEST_EXIT", "0");
      const args = [
        "install",
        "",
        "two words",
        "a&b",
        "(parentheses)",
        'quoted"value',
        "trailing\\",
      ];
      expect(commandPath("vp")?.toLowerCase()).toBe(path.join(bin, "vp.cmd").toLowerCase());
      run("vp", args, { cwd: root });
      expect(JSON.parse(readFileSync(output, "utf8"))).toEqual(args);
      const result = await runWithOutput("vp", args, { cwd: root, env: { ...process.env } });
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(readFileSync(output, "utf8"))).toEqual(args);
      expect(getCommandOutput("vp", args, { cwd: root })).toBe("vp v0.3.1");
      expect(JSON.parse(readFileSync(output, "utf8"))).toEqual(args);

      vi.stubEnv("SETUP_VP_TEST_EXIT", "7");
      expect(() => run("vp", [], { cwd: root })).toThrow("exited with code 7");
      expect((await runWithOutput("vp", [], { cwd: root })).exitCode).toBe(7);
      expect(getCommandOutput("vp", [], { cwd: root })).toBeUndefined();
    },
  );
});
