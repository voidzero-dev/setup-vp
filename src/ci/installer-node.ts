import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveProjectNodeVersion } from "./project-node-version.js";

const EXACT_NODE_VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** Exchange the explicit Node selection with installers that support runtime reuse. */
export function createInstallerNodeContext(
  nodeVersion?: string,
  nodeManager?: boolean,
  projectDir?: string,
) {
  const selector =
    nodeManager === false
      ? undefined
      : nodeVersion || (projectDir ? resolveProjectNodeVersion(projectDir) : undefined);
  const directory = mkdtempSync(join(tmpdir(), "setup-vp-node-"));
  const resultFile = join(directory, "version");
  return {
    env: {
      // Empty clears inherited overrides and keeps the installer's LTS default.
      VP_SETUP_NODE_VERSION: selector || "",
      VP_SETUP_NODE_VERSION_FILE: resultFile,
    },
    reset(): void {
      rmSync(resultFile, { force: true });
    },
    resolvedVersion(): string | undefined {
      // Automatic project selection must retain its normal directory scope.
      if (!nodeVersion || nodeManager === false) return undefined;
      try {
        const version = readFileSync(resultFile, "utf8").trim();
        if (!EXACT_NODE_VERSION_RE.test(version)) {
          throw new Error(`Invalid Node.js version from the Vite+ installer: ${version}`);
        }
        return version;
      } catch (error) {
        // Older releases do not write a result; retain the original selector.
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw error;
      }
    },
    dispose(): void {
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
