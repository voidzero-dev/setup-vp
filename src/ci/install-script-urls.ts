// The install script evolves with the CLI: a script from main can install an
// older CLI incorrectly (e.g. the XDG directory-layout switch in
// voidzero-dev/vite-plus#2346 changes where fresh installs land). When the
// requested version maps to a git ref in the vite-plus repo — the release tag
// for an exact version, the commit itself for a pkg.pr.new preview build —
// prefer the script from that ref so script and CLI always match. Dist-tags
// ("latest", "next") keep using the latest script, which matches whatever they
// resolve to.
const REPO_RAW_BASE = "https://raw.githubusercontent.com/voidzero-dev/vite-plus";
// jsDelivr mirrors GitHub refs on independent infrastructure, so the pinned
// script stays reachable through a raw.githubusercontent.com incident.
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

// An exact published version (`major.minor.patch` with an optional prerelease
// suffix, e.g. `0.1.21-alpha.7`) maps to its `v<version>` release tag. Build
// metadata (`+meta`) is excluded: vite-plus never publishes it and `+` would
// need URL-escaping. Anything else — dist-tags, ranges passed through the raw
// `version` input — cannot be mapped to a ref.
const EXACT_RELEASE_VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export function pkgPrNewCommitSha(version: string): string | undefined {
  return version.match(PKG_PR_NEW_COMMIT_RE)?.[1];
}

export interface InstallScriptUrls {
  /**
   * Script URLs pinned to the git ref matching the requested version; empty
   * when the version cannot be mapped to a ref.
   */
  pinned: string[];
  /**
   * Latest-script URLs: the viteplus.dev CDN first, then the vite-plus repo
   * main branch, so a CDN/edge incident doesn't fully block CI.
   */
  latest: string[];
}

export function getInstallScriptUrls(
  version: string,
  platform: NodeJS.Platform = process.platform,
): InstallScriptUrls {
  const script = platform === "win32" ? "install.ps1" : "install.sh";
  const ref = installScriptRef(version);
  return {
    pinned: ref
      ? [
          `${REPO_RAW_BASE}/${ref}/${SCRIPT_DIR}/${script}`,
          `${REPO_CDN_BASE}@${ref}/${SCRIPT_DIR}/${script}`,
        ]
      : [],
    latest: [`https://viteplus.dev/${script}`, `${REPO_RAW_BASE}/main/${SCRIPT_DIR}/${script}`],
  };
}

function installScriptRef(version: string): string | undefined {
  // Git SHAs are lowercase; normalize so an uppercase-hex version still hits
  // the ref. Check the commit shape first: it also matches the exact-version
  // regex but must resolve to the commit, not a `v0.0.0-commit.*` tag.
  const sha = pkgPrNewCommitSha(version);
  if (sha) return sha.toLowerCase();
  if (EXACT_RELEASE_VERSION_RE.test(version)) return `v${version}`;
  return undefined;
}
