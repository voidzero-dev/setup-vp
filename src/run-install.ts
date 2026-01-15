import { startGroup, endGroup, setFailed, info } from "@actions/core";
import { exec } from "@actions/exec";
import type { Inputs } from "./types.js";

export async function runViteInstall(inputs: Inputs): Promise<void> {
  for (const options of inputs.runInstall) {
    const args = ["install"];
    if (options.args) {
      args.push(...options.args);
    }

    const cwd = options.cwd || process.env.GITHUB_WORKSPACE || process.cwd();
    const cmdStr = `vite ${args.join(" ")}`;

    startGroup(`Running ${cmdStr} in ${cwd}...`);

    try {
      const exitCode = await exec("vite", args, {
        cwd,
        ignoreReturnCode: true,
      });

      if (exitCode !== 0) {
        setFailed(`Command "${cmdStr}" (cwd: ${cwd}) exited with code ${exitCode}`);
      } else {
        info(`Successfully ran ${cmdStr}`);
      }
    } catch (error) {
      setFailed(`Failed to run ${cmdStr}: ${error}`);
    } finally {
      endGroup();
    }
  }
}
