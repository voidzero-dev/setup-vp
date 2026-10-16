import { pkgPrNewCommitSha } from "./install-script-urls.js";
import { createVitePlusDirsFile, supportsVitePlusDirs, VP_DIRS_FILE_ENV } from "./vp-dirs.js";

export function createInstallerEnvironment(
  version: string,
  parentEnv: NodeJS.ProcessEnv,
  nodeEnv: Record<string, string>,
): { env: Record<string, string>; dirsFile: string | undefined } {
  const env: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(parentEnv).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    ),
    ...nodeEnv,
    VP_VERSION: version,
    // Keep compatibility with releases before the VP_* variable rename.
    VITE_PLUS_VERSION: version,
  };
  const dirsFile = supportsVitePlusDirs(version) ? createVitePlusDirsFile() : undefined;
  if (dirsFile) {
    env.VP_VPDIRS_AWARE = "1";
    env[VP_DIRS_FILE_ENV] = dirsFile;
  } else {
    delete env.VP_VPDIRS_AWARE;
    delete env[VP_DIRS_FILE_ENV];
  }
  const prVersion = pkgPrNewCommitSha(version);
  if (prVersion) env.VP_PR_VERSION = prVersion;
  return { env, dirsFile };
}
