import {
  copyFileSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
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

  it.skipIf(process.platform !== "win32")(
    "runs vp.exe from a directory with spaces through every helper",
    async () => {
      const root = mkdtempSync(path.join(tmpdir(), "setup-vp-exe-"));
      directories.push(root);
      const bin = path.join(root, "bin with spaces");
      const output = path.join(root, "arguments.json");
      mkdirSync(bin, { recursive: true });
      copyFileSync(process.execPath, path.join(bin, "vp.exe"));
      const script = path.join(root, "record.cjs");
      writeFileSync(
        script,
        `
const fs = require('node:fs');
fs.writeFileSync(process.env.SETUP_VP_TEST_ARGS, JSON.stringify(process.argv.slice(2)));
console.log('vp v0.3.1');
process.exit(Number(process.env.SETUP_VP_TEST_EXIT || 0));
`,
      );
      vi.stubEnv("PATH", `${bin}${path.delimiter}${process.env.PATH || ""}`);
      vi.stubEnv("PATHEXT", ".COM;.EXE");
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
      const commandArgs = [script, ...args];
      // where.exe can expand TEMP's 8.3 spelling. Check file identity rather
      // than requiring the same spelling for equivalent Windows paths.
      const resolvedPath = commandPath("vp");
      expect(resolvedPath).toBeDefined();
      const expectedFile = statSync(path.join(bin, "vp.exe"), { bigint: true });
      expect(statSync(resolvedPath!, { bigint: true })).toMatchObject({
        dev: expectedFile.dev,
        ino: expectedFile.ino,
      });
      run("vp", commandArgs, { cwd: root });
      expect(JSON.parse(readFileSync(output, "utf8"))).toEqual(args);
      const result = await runWithOutput("vp", commandArgs, { cwd: root, env: { ...process.env } });
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(readFileSync(output, "utf8"))).toEqual(args);
      expect(getCommandOutput("vp", commandArgs, { cwd: root })).toBe("vp v0.3.1");
      expect(JSON.parse(readFileSync(output, "utf8"))).toEqual(args);

      vi.stubEnv("SETUP_VP_TEST_EXIT", "7");
      expect(() => run("vp", [script], { cwd: root })).toThrow("exited with code 7");
      expect((await runWithOutput("vp", [script], { cwd: root })).exitCode).toBe(7);
      expect(getCommandOutput("vp", [script], { cwd: root })).toBeUndefined();
    },
  );
});
