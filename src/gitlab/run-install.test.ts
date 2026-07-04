import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { parseFlowArray, parseRunInstall, runInstall } from "./run-install.js";

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "setup-vp-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("GitLab run-install parsing", () => {
  it("parses booleans, JSON, and the supported YAML subset", () => {
    expect(parseRunInstall("false")).toEqual([]);
    expect(parseRunInstall("null")).toEqual([]);
    expect(parseRunInstall("true")).toEqual([{}]);
    expect(parseRunInstall('[{"cwd":"app"},{"args":["--prod"]}]')).toEqual([
      { cwd: "app" },
      { args: ["--prod"] },
    ]);
    expect(parseRunInstall('{"cwd":"app","args":["--frozen-lockfile"]}')).toEqual([
      { cwd: "app", args: ["--frozen-lockfile"] },
    ]);
    expect(parseRunInstall("- cwd: ./app\n  args: ['--frozen-lockfile']\n- cwd: ./lib")).toEqual([
      { cwd: "./app", args: ["--frozen-lockfile"] },
      { cwd: "./lib" },
    ]);
  });

  it("parses block YAML args", () => {
    expect(parseRunInstall("cwd: ./packages/app\nargs:\n  - --frozen-lockfile")).toEqual([
      { cwd: "./packages/app", args: ["--frozen-lockfile"] },
    ]);
    expect(
      parseRunInstall("- cwd: ./app\n  args:\n    - --frozen-lockfile\n    - --prefer-offline"),
    ).toEqual([{ cwd: "./app", args: ["--frozen-lockfile", "--prefer-offline"] }]);
  });

  it("rejects unsupported keys", () => {
    expect(() => parseRunInstall("command: install")).toThrow(
      "unsupported run-install key: command",
    );
    expect(() => parseRunInstall('{"command":"install"}')).toThrow(
      "unsupported run-install key: command",
    );
  });

  it("rejects invalid JSON entry fields", () => {
    expect(() => parseRunInstall('{"cwd":1}')).toThrow("run-install.cwd must be a string");
    expect(() => parseRunInstall('{"args":[1]}')).toThrow(
      "run-install.args must be an array of strings",
    );
  });

  it("parses quoted flow array items", () => {
    expect(parseFlowArray("['--filter', \"@scope/app\"]")).toEqual(["--filter", "@scope/app"]);
  });

  it("rejects malformed flow array items", () => {
    expect(() => parseFlowArray("['--a',, '--b']")).toThrow(
      "args flow array entries must be non-empty strings",
    );
    expect(() => parseRunInstall("args: ['--a',, '--b']")).toThrow(
      "args flow array entries must be non-empty strings",
    );
    expect(() => parseFlowArray("['--a', '--b]")).toThrow(
      "unterminated quoted string in args flow array",
    );
  });

  it("matches GitHub Actions args validation by allowing empty strings", () => {
    expect(parseRunInstall('{"args":[""]}')).toEqual([{ args: [""] }]);
    expect(parseRunInstall("args: ['']")).toEqual([{ args: [""] }]);
    expect(parseRunInstall("args:\n  - ''")).toEqual([{ args: [""] }]);
  });
});

describe("GitLab run-install execution", () => {
  it("runs install entries with cwd and args", () => {
    const dir = tempDir();
    const binDir = path.join(dir, "bin");
    const appDir = path.join(dir, "app");
    const logFile = path.join(dir, "run.log");
    mkdirSync(binDir);
    mkdirSync(appDir);
    const vpBin = path.join(binDir, "vp");
    writeFileSync(
      vpBin,
      `#!/usr/bin/env sh\nprintf '%s\\n%s\\n' "$PWD" "$*" > "${logFile}"\n`,
      "utf8",
    );
    chmodSync(vpBin, 0o755);

    const previousPath = process.env.PATH;
    try {
      process.env.PATH = `${binDir}:${previousPath || ""}`;
      runInstall([{ cwd: "app", args: ["--frozen-lockfile"] }], dir, "vp");
    } finally {
      process.env.PATH = previousPath;
    }

    expect(readFileSync(logFile, "utf8")).toBe(
      `${realpathSync(appDir)}\ninstall --frozen-lockfile\n`,
    );
  });

  it("runs install entries through sfw when requested", () => {
    const dir = tempDir();
    const binDir = path.join(dir, "bin");
    const logFile = path.join(dir, "sfw.log");
    mkdirSync(binDir);
    const sfwBin = path.join(binDir, "sfw");
    writeFileSync(sfwBin, `#!/usr/bin/env sh\nprintf '%s\\n' "$*" > "${logFile}"\n`, "utf8");
    chmodSync(sfwBin, 0o755);

    const previousPath = process.env.PATH;
    try {
      process.env.PATH = `${binDir}:${previousPath || ""}`;
      runInstall([{}], dir, "sfw");
    } finally {
      process.env.PATH = previousPath;
    }

    expect(readFileSync(logFile, "utf8")).toBe("vp install\n");
  });

  it("does not expose SETUP_VP_ENV_FILE to install subprocesses", () => {
    const dir = tempDir();
    const binDir = path.join(dir, "bin");
    const logFile = path.join(dir, "env.log");
    mkdirSync(binDir);
    const vpBin = path.join(binDir, "vp");
    writeFileSync(
      vpBin,
      [
        "#!/usr/bin/env sh",
        'if [ "${SETUP_VP_ENV_FILE+x}" = "x" ]; then',
        `  printf 'present:%s\\n' "$SETUP_VP_ENV_FILE" > "${logFile}"`,
        "else",
        `  printf 'missing\\n' > "${logFile}"`,
        "fi",
      ].join("\n"),
      "utf8",
    );
    chmodSync(vpBin, 0o755);

    const previousPath = process.env.PATH;
    const previousEnvFile = process.env.SETUP_VP_ENV_FILE;
    try {
      process.env.PATH = `${binDir}:${previousPath || ""}`;
      process.env.SETUP_VP_ENV_FILE = path.join(dir, "setup-vp.env");
      runInstall([{}], dir, "vp");
    } finally {
      process.env.PATH = previousPath;
      if (previousEnvFile === undefined) {
        delete process.env.SETUP_VP_ENV_FILE;
      } else {
        process.env.SETUP_VP_ENV_FILE = previousEnvFile;
      }
    }

    expect(readFileSync(logFile, "utf8")).toBe("missing\n");
  });
});
