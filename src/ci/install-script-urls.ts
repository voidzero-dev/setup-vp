import { isWindows } from "./platform.js";
import manifest from "./installer-checksums.json" with { type: "json" };

const REPO_RAW_BASE = "https://raw.githubusercontent.com/voidzero-dev/vite-plus";
const REPO_CDN_BASE = "https://cdn.jsdelivr.net/gh/voidzero-dev/vite-plus";
const SCRIPT_DIR = "packages/cli";

// pkg.pr.new preview builds are published as `0.0.0-commit.<sha>` (for example
// via the vite-plus registry bridge that `vp migrate` writes into `.npmrc`).
// Those builds live only on pkg.pr.new, never on the npm registry, and the
// install script does not read `.npmrc`: it resolves `VP_VERSION` straight
// from the npm registry, so a commit build 404s there. Extract the commit SHA
// so callers can route it through the script's pkg.pr.new path via
// VP_PR_VERSION. The bridge only ever publishes `0.0.0-commit.<full 40-char
// sha>`, and the install script maps a 40-char SHA straight to that build, so
// require exactly 40 hex chars and nothing shorter is mistaken for a commit
// build.
const PKG_PR_NEW_COMMIT_RE = /^0\.0\.0-commit\.([0-9a-f]{40})$/i;

export function pkgPrNewCommitSha(version: string): string | undefined {
  return version.match(PKG_PR_NEW_COMMIT_RE)?.[1];
}

export interface InstallerFile {
  url: string;
  sha256: string;
}

export interface InstallScriptSource extends InstallerFile {
  legacy?: InstallerFile;
}

interface InstallerPin {
  commit: string;
  sh: string;
  ps1: string;
  legacy_sh?: string;
  legacy_ps1?: string;
}

const releases: Record<string, InstallerPin> = manifest.releases;

export function getInstallScriptSources(
  version: string,
  platform: NodeJS.Platform = process.platform,
): { pinned: InstallScriptSource[]; fallback: InstallScriptSource[] } {
  const extension = isWindows(platform) ? "ps1" : "sh";
  function sources(pin: InstallerPin): InstallScriptSource[] {
    const path = `${SCRIPT_DIR}/install.${extension}`;
    return [`${REPO_RAW_BASE}/${pin.commit}/${path}`, `${REPO_CDN_BASE}@${pin.commit}/${path}`].map(
      (url) => {
        const legacySha256 = pin[`legacy_${extension}`];
        return {
          url,
          sha256: pin[extension],
          ...(legacySha256
            ? {
                legacy: {
                  url: url.replace(`install.${extension}`, `install-legacy.${extension}`),
                  sha256: legacySha256,
                },
              }
            : {}),
        };
      },
    );
  }

  // Keep historical installer/layout compatibility without trusting moving tags
  // or checksums fetched alongside the script. Unknown releases and previews
  // use the fallback approved in this setup-vp release, never upstream main.
  const pin = Object.hasOwn(releases, version) ? releases[version] : undefined;
  const fallback = releases[manifest.defaultVersion]!;
  return {
    pinned: pin && pin.commit !== fallback.commit ? sources(pin) : [],
    fallback: sources(fallback),
  };
}
