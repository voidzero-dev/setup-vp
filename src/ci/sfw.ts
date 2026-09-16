import { pkgPrNewCommitSha } from "./install-script-urls.js";
import type { LogFn } from "./types.js";

export function resolveSfwEnabled(enabled: boolean, version: string, logWarning: LogFn): boolean {
  if (!enabled) return false;
  if (!pkgPrNewCommitSha(version)) return true;

  logWarning(
    `sfw was requested but is automatically disabled for Vite+ preview build ${version}; Socket Firewall Free will not be used.`,
  );
  return false;
}
