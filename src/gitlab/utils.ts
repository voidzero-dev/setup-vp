import { resolveProjectDirectory } from "../ci/project.js";
import type { RuntimeEnv } from "./types.js";

export function resolveProjectDir(runtimeEnv: RuntimeEnv = process.env): string {
  return resolveProjectDirectory({
    workingDirectory: runtimeEnv.SETUP_VP_WORKING_DIRECTORY || ".",
    workspaceRoot: runtimeEnv.CI_PROJECT_DIR || process.cwd(),
  });
}
