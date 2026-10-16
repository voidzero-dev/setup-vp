import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Exchange the explicit Node selection with installers that support runtime reuse. */
export function createInstallerNodeContext(nodeVersion?: string, nodeManager?: boolean) {
  const directory = mkdtempSync(join(tmpdir(), "setup-vp-node-"));
  const resultFile = join(directory, "version");
  return {
    env: {
      // Keep bootstrap independent of project pins when management is disabled.
      VP_SETUP_NODE_VERSION: nodeManager === false ? "lts" : nodeVersion || "",
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
        if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
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
