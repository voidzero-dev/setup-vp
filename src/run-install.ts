import { startGroup, endGroup, setFailed, info, warning, error as logError } from "@actions/core";
import { getExecOutput } from "@actions/exec";
import type { Inputs } from "./types.js";
import { getConfiguredProjectDir, getInstallCwd } from "./utils.js";

const MAX_ERROR_TAIL = 4000;

// sfw resolves the wrapped command on Windows by shelling out to
// `powershell.exe Get-Command` under a hard 10s child-process timeout
// (sfw-free v1.15.0, resolveWindowsCommand). A cold PowerShell start can
// exceed that, and sfw reports the killed lookup as "Command 'vp' not found
// in PATH" even though vp is installed. A genuine not-found returns in ~1s,
// so this signature on a wrapped install is near-certainly the timeout flake.
const SFW_VP_NOT_FOUND_RE = /Command 'vp' not found in PATH/;

export function isSfwVpNotFoundFlake(stdout: string, stderr: string): boolean {
  return SFW_VP_NOT_FOUND_RE.test(stderr) || SFW_VP_NOT_FOUND_RE.test(stdout);
}

// Absorb the PowerShell cold start (assembly JIT + Get-Command module
// analysis over PSModulePath) with an uncapped lookup so sfw's retried
// 10s-limited resolution runs against warm caches. Best effort: a failure
// here must not block the retry.
async function warmPowerShellCommandCache(): Promise<void> {
  if (process.platform !== "win32") return;
  try {
    await getExecOutput("powershell.exe", ["-NoProfile", "-Command", "Get-Command vp"], {
      ignoreReturnCode: true,
    });
  } catch (error) {
    info(`PowerShell warm-up failed (${String(error)}); retrying sfw anyway.`);
  }
}

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

    const attempt = async (label: string) => {
      startGroup(`Running ${label} in ${cwd}...`);
      try {
        return await getExecOutput(cmd, args, {
          cwd,
          ignoreReturnCode: true,
        });
      } finally {
        endGroup();
      }
    };

    try {
      let result = await attempt(cmdStr);

      if (
        result.exitCode !== 0 &&
        inputs.sfw &&
        isSfwVpNotFoundFlake(result.stdout, result.stderr)
      ) {
        warning(
          "sfw reported vp as not found even though it is on PATH. This is a known sfw flake on Windows: a cold PowerShell start exceeds sfw's 10s command-resolution timeout and the timeout is misreported as not-found. Warming the PowerShell command cache and retrying once.",
        );
        await warmPowerShellCommandCache();
        result = await attempt(`${cmdStr} (retry)`);
      }

      if (result.exitCode === 0) {
        info(`Successfully ran ${cmdStr}`);
        continue;
      }

      const detail = result.stderr.trim() || result.stdout.trim();
      if (detail) {
        logError(tailOutput(detail, MAX_ERROR_TAIL), {
          title: `${cmdStr} failed`,
        });
      }
      setFailed(`Command "${cmdStr}" (cwd: ${cwd}) exited with code ${result.exitCode}`);
    } catch (error) {
      setFailed(`Failed to run ${cmdStr}: ${String(error)}`);
    }
  }
}
