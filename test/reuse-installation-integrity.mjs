import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(process.env.RUNNER_TEMP, "setup-vp-reuse-integrity");
const project = join(root, "project");
const home = join(root, "installation");
const vp = join(home, "bin", process.platform === "win32" ? "vp.exe" : "vp");
const bundle = fileURLToPath(new URL("../dist/index.mjs", import.meta.url));
const managers = ["npm", "pnpm", "yarn", "bun"];
const overrides = ["VP_PM_MANAGER", ...managers.map((name) => `VP_${name.toUpperCase()}_MANAGER`)];

function runVp(args) {
  return execFileSync(vp, args, { cwd: project, encoding: "utf8" });
}

switch (process.argv[2]) {
  case "prepare": {
    mkdirSync(project, { recursive: true });
    writeFileSync(join(project, "package.json"), '{"private":true}');
    writeFileSync(join(project, "review.js"), "console.log('binding works');\n");
    appendFileSync(process.env.GITHUB_ENV, `VP_HOME=${home}\n`);
    break;
  }

  case "remove-binding": {
    runVp(["lint", "review.js"]);
    const packageDir = realpathSync(join(home, "current", "node_modules", "vite-plus"));
    // Load in a child so Windows releases the native library before we move it.
    const files = JSON.parse(
      execFileSync(
        process.execPath,
        [
          "--input-type=commonjs",
          "--eval",
          "require(process.argv[1]); console.log(JSON.stringify(Object.keys(require.cache).filter(file => file.endsWith('.node'))));",
          join(packageDir, "binding", "index.cjs"),
        ],
        { cwd: project, encoding: "utf8" },
      ),
    );
    const nativeFile = files.find((file) => file.includes("vite-plus"));
    assert.ok(nativeFile, "The global CLI must load its native binding");
    // Moving a single pnpm link is insufficient: another link can still resolve it.
    renameSync(dirname(realpathSync(nativeFile)), join(root, "removed-native-package"));
    runVp(["--version"]);
    const broken = spawnSync(vp, ["lint", "review.js"], { cwd: project, encoding: "utf8" });
    assert.notEqual(broken.status, 0);
    assert.match(broken.stderr, /Cannot find native binding/);
    console.log("Native version probe succeeds, but the JavaScript CLI has a missing binding.");
    break;
  }

  case "verify-repair": {
    runVp(["lint", "review.js"]);
    console.log("The action repaired the missing native binding.");
    break;
  }

  case "manager-overrides": {
    for (const override of overrides) {
      runVp(["env", "on"]);
      const env = {
        ...process.env,
        INPUT_VERSION: "0.3.3",
        "INPUT_RUN-INSTALL": "false",
        INPUT_CACHE: "false",
        "INPUT_CACHE-SAVE": "false",
        INPUT_SFW: "false",
      };
      for (const key of overrides) delete env[key];
      env[override] = "no";
      const output = execFileSync(process.execPath, [bundle], {
        cwd: project,
        env,
        encoding: "utf8",
        timeout: 180_000,
      });
      assert.doesNotMatch(output, /Reusing Vite\+/);
      for (const manager of managers) {
        const { package_manager: current } = JSON.parse(
          runVp(["env", "current", manager, "--json"]),
        );
        const disabled =
          override === "VP_PM_MANAGER" || override === `VP_${manager.toUpperCase()}_MANAGER`;
        assert.equal(
          current.mode,
          disabled ? "system_first" : "managed",
          `${override}: ${manager}`,
        );
      }
      console.log(`${override}=no applies the installer package-manager settings.`);
    }
    break;
  }

  default:
    throw new Error(`Unknown integrity check: ${process.argv[2]}`);
}
