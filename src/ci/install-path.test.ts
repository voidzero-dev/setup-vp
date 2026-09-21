import { describe, expect, it } from "vite-plus/test";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installVitePlus } from "./install-viteplus.js";
import { isWindows } from "./platform.js";
import { exportShellEnv, shellQuote } from "../gitlab/shell.js";

describe("installed PATH", () => {
  it.skipIf(isWindows())(
    "resolves managed and system-first tools now and in later GitLab shells",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "setup-vp-path-"));
      const bin = join(root, "custom bin");
      const data = join(root, "data");
      const config = join(root, "config");
      const fallback = join(data, "fallback-bin");
      const system = join(root, "system");
      const downloads = join(root, "downloads");
      const later = join(root, "later");
      const envFile = join(root, "exports");
      for (const dir of [bin, data, config, fallback, system, downloads, later])
        mkdirSync(dir, { recursive: true });
      const executable = (dir: string, name: string, body: string) => {
        const file = join(dir, name);
        writeFileSync(file, `#!/bin/bash\n${body}\n`);
        chmodSync(file, 0o755);
      };
      try {
        // Serve an isolated installer and generated environment, without downloading or touching a real installation.
        const installer = join(root, "install.sh");
        writeFileSync(installer, `SHIM_DIR=${shellQuote(bin)}\n`);
        executable(downloads, "curl", `cp ${shellQuote(installer)} "$8"`);
        executable(
          bin,
          "vp",
          `if [ "$VP_DUMP_DIRS" = 1 ]; then\nprintf '%s\\n' ${["data\t" + data, "bin\t" + bin, "cache\t" + root, "config\t" + config, "state\t" + root].map(shellQuote).join(" ")}\nelse echo 'vp v0.3.3'; fi`,
        );
        writeFileSync(
          join(config, "env"),
          `export PATH=${shellQuote(bin)}:"$PATH":${shellQuote(fallback)}\n`,
        );
        executable(bin, "npm", "echo managed-npm");
        executable(bin, "pnpm", "echo managed-pnpm");
        executable(fallback, "pnpm", "echo fallback-pnpm");
        const env = { HOME: root, PATH: `${downloads}:/usr/bin:/bin`, SETUP_VP_ENV_FILE: envFile };
        await installVitePlus("0.3.3", {
          env,
          exportPath: (value) => exportShellEnv("PATH", value, env),
        });
        const resolve = (command: string, persisted = false) => {
          const result = spawnSync(
            "/bin/bash",
            ["-c", `${persisted ? `source ${shellQuote(envFile)}; ` : ""}${command}`],
            { env: persisted ? { HOME: root, PATH: "/usr/bin:/bin" } : env, encoding: "utf8" },
          );
          expect(result.status, result.stderr).toBe(0);
          return result.stdout.trim();
        };
        for (const persisted of [false, true])
          expect(resolve("pnpm", persisted)).toBe("managed-pnpm");
        // Model env off pnpm after setup: the shim leaves main bin; other families stay managed.
        rmSync(join(bin, "pnpm"));
        executable(system, "pnpm", "echo system-pnpm");
        executable(later, "pnpm", "echo later-pnpm");
        for (const persisted of [false, true]) {
          expect(resolve("pnpm", persisted)).toBe("fallback-pnpm");
          expect(resolve("npm", persisted)).toBe("managed-npm");
          expect(resolve(`PATH=${shellQuote(system)}:"$PATH" pnpm`, persisted)).toBe("system-pnpm");
          expect(resolve(`PATH=${shellQuote(later)}:"$PATH" pnpm`, persisted)).toBe("later-pnpm");
        }
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );
});
