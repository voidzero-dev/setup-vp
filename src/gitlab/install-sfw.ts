import { createWriteStream, existsSync } from "node:fs";
import { chmod, mkdtemp } from "node:fs/promises";
import { get as httpGet } from "node:http";
import { get as httpsGet } from "node:https";
import { tmpdir } from "node:os";
import path from "node:path";
import { commandPath, exportShellEnv } from "./shell.js";
import type { InstallCommand, RunInstallEntry } from "./types.js";

const SFW_VERSION = "v1.12.0";
const SFW_RELEASE_BASE = `https://github.com/SocketDev/sfw-free/releases/download/${SFW_VERSION}`;
const DOWNLOAD_TIMEOUT_MS = 60_000;
type DownloadClient = typeof httpGet;

export function isMuslLinux(): boolean {
  if (process.platform !== "linux") return false;
  try {
    const report = process.report?.getReport() as
      | { header?: { glibcVersionRuntime?: string } }
      | undefined;
    if (report?.header && !report.header.glibcVersionRuntime) {
      return true;
    }
  } catch {
    // Fall through to filesystem fallback.
  }
  return existsSync("/etc/alpine-release");
}

/**
 * Mirrors src/install-sfw.ts asset naming for GitLab's supported Unix runners.
 */
export function getSfwAssetName(platform: NodeJS.Platform, arch: string, isMusl: boolean): string {
  if (platform === "darwin") {
    if (arch === "x64") return "sfw-free-macos-x86_64";
    if (arch === "arm64") return "sfw-free-macos-arm64";
  }

  if (platform === "linux") {
    if (arch === "x64") return isMusl ? "sfw-free-musl-linux-x86_64" : "sfw-free-linux-x86_64";
    if (arch === "arm64") return isMusl ? "sfw-free-musl-linux-arm64" : "sfw-free-linux-arm64";
  }

  const libcSuffix = platform === "linux" ? ` (${isMusl ? "musl" : "glibc"})` : "";
  throw new Error(`Unsupported platform/arch for sfw: ${platform}/${arch}${libcSuffix}`);
}

export function sfwAssetName(): string | undefined {
  try {
    return getSfwAssetName(process.platform, process.arch, isMuslLinux());
  } catch {
    return undefined;
  }
}

export function isSfwSupported(): boolean {
  return !!sfwAssetName();
}

function sfwEnvironmentDescription(): string {
  return `process.platform=${process.platform}, process.arch=${process.arch}, musl=${isMuslLinux()}`;
}

export function downloadFile(
  url: string,
  outputPath: string,
  redirects = 0,
  timeoutMs = DOWNLOAD_TIMEOUT_MS,
  clientOverride?: DownloadClient,
): Promise<void> {
  if (redirects > 5) {
    return Promise.reject(new Error(`too many redirects while downloading ${url}`));
  }

  const client = clientOverride || (url.startsWith("https:") ? httpsGet : httpGet);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };

    const request = client(url, (response) => {
      const statusCode = response.statusCode ?? 0;
      const location = response.headers.location;
      if (statusCode >= 300 && statusCode < 400 && location) {
        response.resume();
        const nextUrl = new URL(location, url).toString();
        downloadFile(nextUrl, outputPath, redirects + 1, timeoutMs, clientOverride).then(
          () => finish(),
          finish,
        );
        return;
      }

      if (statusCode !== 200) {
        response.resume();
        finish(new Error(`download failed with HTTP ${statusCode}: ${url}`));
        return;
      }

      const file = createWriteStream(outputPath);
      response.pipe(file);
      file.on("finish", () => file.close(() => finish()));
      file.on("error", finish);
    });

    const timeout = setTimeout(() => {
      request.destroy(new Error(`download timed out after ${timeoutMs}ms: ${url}`));
    }, timeoutMs);
    request.on("error", finish);
  });
}

export async function setupSfw(
  runInstallEntries: RunInstallEntry[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<InstallCommand> {
  if (env.SETUP_VP_SFW !== "true") return "vp";

  if (runInstallEntries.length === 0) {
    console.log(
      "setup-vp: sfw was requested but run-install is disabled; sfw will not be invoked.",
    );
    return "vp";
  }

  const existing = commandPath("sfw");
  if (existing) {
    console.log(`setup-vp: using existing sfw on PATH: ${existing}`);
    return "sfw";
  }

  const asset = sfwAssetName();
  if (!asset) {
    console.error(
      `setup-vp: sfw has no published binary for this runner's platform/architecture (${sfwEnvironmentDescription()}) and none was found on PATH; falling back to plain vp install.`,
    );
    return "vp";
  }

  const sfwDir = await mkdtemp(path.join(tmpdir(), "setup-vp-sfw-"));
  const sfwBin = path.join(sfwDir, "sfw");
  const sfwUrl = `${SFW_RELEASE_BASE}/${asset}`;

  for (let round = 1; round <= 2; round += 1) {
    try {
      console.log(`setup-vp: installing sfw ${SFW_VERSION} from ${sfwUrl}`);
      await downloadFile(sfwUrl, sfwBin);
      await chmod(sfwBin, 0o755);
      env.PATH = `${sfwDir}:${env.PATH || ""}`;
      exportShellEnv("PATH", env.PATH, env);
      return "sfw";
    } catch (error) {
      if (round === 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  throw new Error("failed to install sfw after retrying");
}
