/**
 * Extract the installed global Vite+ version from `vp --version` output.
 *
 * vp >= 0.2 prints the global version as `vp v0.2.0` on the first line; older
 * builds printed `- Global: v0.2.0`. Returns "unknown" when neither shape matches.
 */
export function parseInstalledVpVersion(versionOutput: string): string {
  const match =
    versionOutput.match(/^\s*vp\s+v?(\d[^\s]*)/im) ??
    versionOutput.match(/Global:\s*v?(\d[^\s]*)/i);
  return match?.[1] ?? "unknown";
}
