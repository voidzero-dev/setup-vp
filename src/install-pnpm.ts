import { info } from "@actions/core";
import { exec } from "@actions/exec";
import type { Inputs } from "./types.js";

export async function installPnpm(inputs: Inputs): Promise<void> {
  if (!inputs.pnpm) return;

  info("Installing pnpm globally...");
  await exec("vp", ["install", "-g", "pnpm"]);
}
