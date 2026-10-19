import { exec, getExecOutput } from "@actions/exec";
import { copyFileSync, lstatSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { ToolchainCachePlan } from "./ci/toolchain-cache.js";
import { getVitePlusBinDirs, parseVitePlusDirs } from "./ci/vp-dirs.js";
import type { VitePlusBinDirs } from "./ci/vp-dirs.js";

// Only call this with a validated, exact cache hit. Keep activation and shim
// creation in Vite+'s native installer instead of duplicating its layout here.
export async function bootstrapToolchain(
  plan: ToolchainCachePlan,
  env: Record<string, string>,
  cwd: string,
): Promise<VitePlusBinDirs | undefined> {
  const current = join(plan.data, "current");
  if (lstatSync(current, { throwIfNoEntry: false })) return;
  const windows = process.platform === "win32";
  const binaryName = windows ? "vp.exe" : "vp";
  const directory = mkdtempSync(join(tmpdir(), "setup-vp-bootstrap-"));
  try {
    // A marked payload skips self-setup. A temporary copy follows the official
    // installer's standalone-binary handoff without changing the cached marker.
    const binary = join(directory, binaryName);
    copyFileSync(join(plan.payload, "bin", binaryName), binary);
    const bootstrapEnv: Record<string, string> = {
      ...env,
      VP_SELF_SETUP_SHELL: windows ? "powershell" : "sh",
      ...(windows && !env.VP_SHELL ? { VP_SHELL: "powershell" } : {}),
    };
    delete bootstrapEnv.VP_SELF_SETUP_SUPPORT_CHECK;
    delete bootstrapEnv.VP_DUMP_DIRS;
    await exec(binary, [], { cwd, env: bootstrapEnv });
    if (realpathSync(current) !== realpathSync(plan.payload)) {
      throw new Error("Native setup did not activate the cached payload");
    }
    const { stdout } = await getExecOutput(join(current, "bin", binaryName), [], {
      cwd,
      silent: true,
      env: { ...env, VP_DUMP_DIRS: "1" },
    });
    const dirs = parseVitePlusDirs(stdout);
    if (
      !dirs ||
      !Object.values(dirs).every(isAbsolute) ||
      realpathSync(dirs.data) !== realpathSync(plan.data)
    ) {
      throw new Error("Native setup returned an unexpected data directory");
    }
    return getVitePlusBinDirs(dirs);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
