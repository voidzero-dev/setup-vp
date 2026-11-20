import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { chmod, copyFile, lstat, mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import type { get as httpGet } from "node:http";
import { tmpdir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import path from "node:path";
import { isWindows } from "./platform.js";
import { commandPath } from "./process.js";
import { resolveSfwEnabled } from "./sfw.js";
import { getSfwAssetDigest, type SfwAsset } from "./sfw-release-digests.js";
import type { ExportVariable, InstallCommand, LogFn, RunInstallEntry } from "./types.js";

// All integrations use this version pin. Renovate updates it through
// .github/renovate.json so reruns of the same commit download the same release.
export const SFW_VERSION = "v1.15.4";
export const SFW_RELEASE_BASE = `https://github.com/SocketDev/sfw-free/releases/download/${SFW_VERSION}`;
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

export function getSfwAssetName(
  platform: NodeJS.Platform,
  arch: string,
  isMusl: boolean,
): SfwAsset {
  if (platform === "darwin") {
    if (arch === "arm64") return "sfw-free-macos-arm64";
    if (arch === "x64") return "sfw-free-macos-x86_64";
  } else if (platform === "linux") {
    if (arch === "arm64") {
      return isMusl ? "sfw-free-musl-linux-arm64" : "sfw-free-linux-arm64";
    }
    if (arch === "x64") {
      return isMusl ? "sfw-free-musl-linux-x86_64" : "sfw-free-linux-x86_64";
    }
  } else if (isWindows(platform)) {
    if (arch === "arm64") return "sfw-free-windows-arm64.exe";
    if (arch === "x64") return "sfw-free-windows-x86_64.exe";
  }

  const libcSuffix = platform === "linux" ? ` (${isMusl ? "musl" : "glibc"})` : "";
  throw new Error(`Unsupported platform/arch for sfw: ${platform}/${arch}${libcSuffix}`);
}

function downloadFileWithShell(url: string, outputPath: string, timeoutMs: number): void {
  const timeoutSeconds = Math.max(1, Math.ceil(timeoutMs / 1000));
  const curl = commandPath("curl");
  if (curl) {
    const result = spawnSync(
      curl,
      [
        "-fsSL",
        "--connect-timeout",
        "5",
        "--max-time",
        String(timeoutSeconds),
        url,
        "-o",
        outputPath,
      ],
      { stdio: "ignore" },
    );
    if (result.status === 0) return;
    throw result.error || new Error(`curl failed while downloading ${url}`);
  }

  const wget = commandPath("wget");
  if (wget) {
    const result = spawnSync(
      wget,
      ["-q", "-T", String(timeoutSeconds), "-t", "2", "-O", outputPath, url],
      { stdio: "ignore" },
    );
    if (result.status === 0) return;
    throw result.error || new Error(`wget failed while downloading ${url}`);
  }

  throw new Error("curl or wget is required to download sfw");
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

  if (!clientOverride) {
    downloadFileWithShell(url, outputPath, timeoutMs);
    return Promise.resolve();
  }

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

    const request = clientOverride(url, (response) => {
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

async function hasDigest(file: string, expected: string): Promise<boolean> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex") === expected;
}

async function restoreCachedBinary(
  cachedFile: string,
  executable: string,
  digest: string,
  warn: LogFn,
): Promise<boolean> {
  try {
    if ((await lstat(cachedFile)).isFile()) {
      await copyFile(cachedFile, executable);
      if (await hasDigest(executable, digest)) {
        console.log(`setup-vp: using verified cached sfw ${SFW_VERSION}`);
        return true;
      }
    }
    warn(`setup-vp: ignoring invalid cached sfw ${SFW_VERSION}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      warn(`setup-vp: could not use cached sfw ${SFW_VERSION}: ${String(error)}`);
    }
  }
  return false;
}

async function downloadVerifiedBinary(
  download: typeof downloadFile,
  asset: SfwAsset,
  executable: string,
  digest: string,
): Promise<void> {
  const url = `${SFW_RELEASE_BASE}/${asset}`;
  for (let round = 1; ; round += 1) {
    try {
      await rm(executable, { force: true });
      console.log(`setup-vp: installing sfw ${SFW_VERSION} from ${url}`);
      await download(url, executable);
      if (!(await hasDigest(executable, digest))) {
        throw new Error(`SHA-256 mismatch for sfw ${SFW_VERSION} ${asset}`);
      }
      return;
    } catch (error) {
      if (round === 2) throw error;
      await sleep(2000);
    }
  }
}

async function prepareCacheDirectory(directory: string): Promise<void> {
  // Check ancestors before touching this entry. Windows short names may refer
  // to ordinary directories even when their resolved spelling is different.
  const parent = path.dirname(directory);
  if (parent !== directory) await prepareCacheDirectory(parent);

  const entry = await lstat(directory).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
    return undefined;
  });
  if (!entry) await mkdir(directory, { recursive: true });
  if (!(entry ?? (await lstat(directory))).isDirectory()) {
    throw new Error("The sfw cache path contains a link or a non-directory entry.");
  }
}

async function saveCachedBinary(file: string, directory: string): Promise<void> {
  await prepareCacheDirectory(directory);
  const staging = await mkdtemp(path.join(directory, ".setup-vp-"));
  try {
    const stagedFile = path.join(staging, path.basename(file));
    await copyFile(file, stagedFile);
    await rename(stagedFile, path.join(directory, path.basename(file)));
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

async function prepareVerifiedSfw(
  asset: SfwAsset,
  name: string,
  cacheDirectory: string | undefined,
  download: typeof downloadFile,
  warn: LogFn,
): Promise<string> {
  const digest = getSfwAssetDigest(SFW_VERSION, asset);
  if (!digest) throw new Error(`Missing SHA-256 digest for sfw ${SFW_VERSION} ${asset}`);
  const cache = cacheDirectory && path.resolve(cacheDirectory, SFW_VERSION, asset);
  // Execute only a verified copy in private staging. The cache can live in the checkout.
  const sfwDir = await mkdtemp(path.resolve(tmpdir(), "setup-vp-sfw-"));
  const sfwBin = path.join(sfwDir, name);

  try {
    const hit = cache && (await restoreCachedBinary(path.join(cache, name), sfwBin, digest, warn));
    if (!hit) {
      await downloadVerifiedBinary(download, asset, sfwBin, digest);
      if (cache) {
        await saveCachedBinary(sfwBin, cache).catch((error: unknown) => {
          warn(`setup-vp: could not save verified sfw ${SFW_VERSION}: ${String(error)}`);
        });
      }
    }
    await chmod(sfwBin, 0o755);
    return sfwBin;
  } catch (error) {
    await rm(sfwDir, { recursive: true, force: true });
    throw error;
  }
}

export async function setupSfw(
  runInstallEntries: RunInstallEntry[],
  options: {
    env?: NodeJS.ProcessEnv;
    sfwEnabled?: boolean;
    vitePlusVersion?: string;
    logWarning?: LogFn;
    exportVariable?: ExportVariable;
    platform?: NodeJS.Platform;
    arch?: string;
    isMusl?: boolean;
    download?: typeof downloadFile;
    cacheDirectory?: string;
  } = {},
): Promise<InstallCommand> {
  const env = options.env ?? process.env;
  const sfwEnabled = options.sfwEnabled ?? env.SETUP_VP_SFW === "true";
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const isMusl = options.isMusl ?? isMuslLinux();
  const download = options.download ?? downloadFile;
  const warn = options.logWarning ?? console.warn;

  const effectiveSfw = resolveSfwEnabled(sfwEnabled, options.vitePlusVersion ?? "", warn);
  if (!effectiveSfw) return { executable: "vp", sfw: false };

  if (runInstallEntries.length === 0) {
    console.log(
      "setup-vp: sfw was requested but run-install is disabled; sfw will not be invoked.",
    );
    return { executable: "vp", sfw: false };
  }

  const existing = commandPath("sfw", env);
  if (existing) {
    console.log(`setup-vp: using existing sfw on PATH: ${existing}`);
    return { executable: existing, sfw: true };
  }

  let asset: SfwAsset;
  try {
    asset = getSfwAssetName(platform, arch, isMusl);
  } catch {
    console.error(
      `setup-vp: sfw has no published binary for this runner's platform/architecture (process.platform=${platform}, process.arch=${arch}, musl=${isMusl}) and none was found on PATH; falling back to plain vp install.`,
    );
    return { executable: "vp", sfw: false };
  }

  const sfwBin = await prepareVerifiedSfw(
    asset,
    isWindows(platform) ? "sfw.exe" : "sfw",
    options.cacheDirectory || env.SETUP_VP_SFW_CACHE_DIR,
    download,
    warn,
  );
  const pathSeparator = isWindows(platform) ? ";" : ":";
  env.PATH = `${path.dirname(sfwBin)}${pathSeparator}${env.PATH || ""}`;
  options.exportVariable?.("PATH", env.PATH);
  return { executable: sfwBin, sfw: true };
}
