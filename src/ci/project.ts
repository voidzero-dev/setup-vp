import { statSync } from "node:fs";
import path from "node:path";

export function resolveProjectDirectory(options: {
  workingDirectory: string;
  workspaceRoot: string;
}): string {
  const { workingDirectory, workspaceRoot } = options;
  const projectDir = path.isAbsolute(workingDirectory)
    ? workingDirectory
    : path.join(workspaceRoot, workingDirectory);

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
