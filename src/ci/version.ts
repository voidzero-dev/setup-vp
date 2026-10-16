const VP_VERSION_RE = /^\s*vp\s+v?(\d[^\s]*)/im;
const LEGACY_GLOBAL_VERSION_RE = /Global:\s*v?(\d[^\s]*)/i;

/**
 * Extract the installed global Vite+ version from `vp --version` output.
 *
 * vp >= 0.2 prints the global version as `vp v0.2.0` on the first line; older
 * builds printed `- Global: v0.2.0`. Returns "unknown" when neither shape matches.
 */
export function parseInstalledVpVersion(versionOutput: string): string {
  const match = versionOutput.match(VP_VERSION_RE) ?? versionOutput.match(LEGACY_GLOBAL_VERSION_RE);
  return match?.[1] ?? "unknown";
}
