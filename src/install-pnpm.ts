import { info } from "@actions/core";
import { exec } from "@actions/exec";
import type { Inputs } from "./types.js";

export async function installPnpm(inputs: Inputs): Promise<void> {
  if (!inputs.installPnpm) return;

  const version = inputs.pnpmVersion || "latest";
  info(`Installing pnpm@${version} globally...`);
  await exec("npm", ["install", "--global", `pnpm@${version}`]);
}
