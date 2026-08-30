import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const RETRY_DELAY_MS = 250;
const STALE_LOCK_MS = 30 * 60 * 1000;

interface LockMetadata {
  createdAt: number;
  pid: number;
}

/**
 * Serialize changes to Vite+'s process-wide installation. Self-hosted runners
 * can execute multiple jobs under one HOME, while Vite+ updates its `current`
 * shim and version directories in place.
 */
export async function withVitePlusInstallLock<T>(
  vitePlusHome: string,
  task: () => Promise<T>,
): Promise<T> {
  const lockPath = `${vitePlusHome}.setup-vp-lock`;

  await acquireLock(lockPath);
  try {
    return await task();
  } finally {
    await rm(lockPath, { recursive: true, force: true });
  }
}

async function acquireLock(lockPath: string): Promise<void> {
  await mkdir(dirname(lockPath), { recursive: true });

  for (;;) {
    try {
      await mkdir(lockPath);
      await writeFile(
        join(lockPath, "owner.json"),
        JSON.stringify({ createdAt: Date.now(), pid: process.pid } satisfies LockMetadata),
      );
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      await removeStaleLock(lockPath);
      await sleep(RETRY_DELAY_MS);
    }
  }
}

async function removeStaleLock(lockPath: string): Promise<void> {
  try {
    const contents = await readFile(join(lockPath, "owner.json"), "utf8");
    const metadata = JSON.parse(contents) as Partial<LockMetadata>;
    await removeWhenExpired(lockPath, metadata.createdAt);
  } catch {
    // A process can be interrupted between mkdir and writing owner.json. The
    // directory timestamp gives that partial lock the same recovery path.
    await removeWhenExpired(lockPath);
  }
}

async function removeWhenExpired(lockPath: string, createdAt?: number): Promise<void> {
  const lockAgeStart = createdAt ?? (await stat(lockPath)).mtimeMs;
  if (Date.now() - lockAgeStart > STALE_LOCK_MS) {
    await rm(lockPath, { recursive: true, force: true });
  }
}
