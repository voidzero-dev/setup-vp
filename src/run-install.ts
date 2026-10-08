import { startGroup, endGroup, setFailed, info, warning, error as logError } from "@actions/core";
import { getExecOutput, type ExecOutput } from "@actions/exec";
import type { Inputs } from "./types.js";
import type { InstallCommand } from "./ci/types.js";
import { getConfiguredProjectDir, getInstallCwd } from "./utils.js";
import { isWindows } from "./ci/platform.js";

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
  if (!isWindows()) return;
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

export async function runViteInstall(
  inputs: Inputs,
  installCommand: InstallCommand,
): Promise<void> {
  const projectDir = getConfiguredProjectDir(inputs);
  const { executable, sfw } = installCommand;
  // @actions/exec parses its first parameter as a command line.
  const commandLine = `"${executable.replaceAll('"', '\\"')}"`;

  for (const options of inputs.runInstall) {
    const installArgs = ["install", ...(options.args || [])];
    const args = sfw ? ["vp", ...installArgs] : installArgs;
    const cwd = getInstallCwd(projectDir, options.cwd);
    const commandLabel = `${executable} ${args.join(" ")}`;

    async function attempt(label: string): Promise<ExecOutput> {
      startGroup(`Running ${label} in ${cwd}...`);
      try {
        return await getExecOutput(commandLine, args, {
          cwd,
          ignoreReturnCode: true,
        });
      } finally {
        endGroup();
      }
    }

    try {
      let result = await attempt(commandLabel);

      if (result.exitCode !== 0 && sfw && isSfwVpNotFoundFlake(result.stdout, result.stderr)) {
        warning(
          "sfw reported vp as not found even though it is on PATH. This is a known sfw flake on Windows: a cold PowerShell start exceeds sfw's 10s command-resolution timeout and the timeout is misreported as not-found. Warming the PowerShell command cache and retrying once.",
        );
        await warmPowerShellCommandCache();
        result = await attempt(`${commandLabel} (retry)`);
      }

      if (result.exitCode === 0) {
        info(`Successfully ran ${commandLabel}`);
        continue;
      }

      const detail = result.stderr.trim() || result.stdout.trim();
      if (detail) {
        logError(tailOutput(detail, MAX_ERROR_TAIL), {
          title: `${commandLabel} failed`,
        });
      }
      setFailed(`Command "${commandLabel}" (cwd: ${cwd}) exited with code ${result.exitCode}`);
    } catch (error) {
      setFailed(`Failed to run ${commandLabel}: ${String(error)}`);
    }
  }
}
