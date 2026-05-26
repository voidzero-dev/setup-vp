import { startGroup, endGroup, setFailed, info, error as logError } from "@actions/core";
import { getExecOutput } from "@actions/exec";
import type { Inputs } from "./types.js";
import { getConfiguredProjectDir, getInstallCwd } from "./utils.js";

const MAX_ERROR_TAIL = 4000;

function tailOutput(buffer: string, max: number): string {
  const trimmed = buffer.trim();
  if (trimmed.length <= max) return trimmed;
  return `…(truncated, showing last ${max} chars)…\n${trimmed.slice(-max)}`;
}

export async function runViteInstall(inputs: Inputs): Promise<void> {
  const projectDir = getConfiguredProjectDir(inputs);

  for (const options of inputs.runInstall) {
    const installArgs = ["install"];
    if (options.args) {
      installArgs.push(...options.args);
    }

    const cmd = inputs.sfw ? "sfw" : "vp";
    const args = inputs.sfw ? ["vp", ...installArgs] : installArgs;
    const cwd = getInstallCwd(projectDir, options.cwd);
    const cmdStr = `${cmd} ${args.join(" ")}`;

    startGroup(`Running ${cmdStr} in ${cwd}...`);

    try {
      const { exitCode, stdout, stderr } = await getExecOutput(cmd, args, {
        cwd,
        ignoreReturnCode: true,
      });
      endGroup();

      if (exitCode === 0) {
        info(`Successfully ran ${cmdStr}`);
        continue;
      }

      const detail = stderr.trim() || stdout.trim();
      if (detail) {
        logError(tailOutput(detail, MAX_ERROR_TAIL), {
          title: `${cmdStr} failed`,
        });
      }
      setFailed(`Command "${cmdStr}" (cwd: ${cwd}) exited with code ${exitCode}`);
    } catch (error) {
      endGroup();
      setFailed(`Failed to run ${cmdStr}: ${String(error)}`);
    }
  }
}
