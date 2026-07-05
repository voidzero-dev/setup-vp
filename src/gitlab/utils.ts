import { statSync } from "node:fs";
import path from "node:path";
import type { RuntimeEnv } from "./types.js";

export function resolveProjectDir(runtimeEnv: RuntimeEnv = process.env): string {
  const workingDirectory = runtimeEnv.SETUP_VP_WORKING_DIRECTORY || ".";
  const projectDir = path.isAbsolute(workingDirectory)
    ? workingDirectory
    : path.join(runtimeEnv.CI_PROJECT_DIR || process.cwd(), workingDirectory);

  try {
    if (!statSync(projectDir).isDirectory()) {
      throw new Error(
        `working-directory is not a directory: ${workingDirectory} (resolved to ${projectDir})`,
      );
    }
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error(
        `working-directory not found: ${workingDirectory} (resolved to ${projectDir})`,
      );
    }
    throw error;
  }

  return projectDir;
}
