import { exportShellEnv } from "./shell.js";
import {
  downloadFile,
  getSfwAssetName,
  isMuslLinux,
  setupSfw as setupSfwCore,
  SFW_VERSION,
} from "../ci/install-sfw.js";
import type { InstallCommand, RunInstallEntry } from "./types.js";

export { downloadFile, getSfwAssetName, isMuslLinux, SFW_VERSION };

export async function setupSfw(
  runInstallEntries: RunInstallEntry[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<InstallCommand> {
  return setupSfwCore(runInstallEntries, {
    env,
    exportVariable: (name, value) => exportShellEnv(name, value, env),
  });
}
