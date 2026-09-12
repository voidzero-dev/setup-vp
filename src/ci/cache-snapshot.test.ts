import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { restoreCacheSnapshot } from "./cache-snapshot.js";

const directories: string[] = [];
afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "setup-vp-cache-"));
  directories.push(root);
  const store = path.join(root, "store");
  const cache = path.join(root, "snapshot");
  const lockFile = path.join(root, "package-lock.json");
  mkdirSync(store);
  writeFileSync(lockFile, "first lock");
  return {
    root,
    store,
    cache,
    lockFile,
    metadata: { ready: true, cachePath: store, lockFile, lockType: "npm" },
  };
}

describe("GitLab cache snapshots", () => {
  it("restores exact hits into the dynamically resolved package-manager store", () => {
    const { store, cache, metadata } = fixture();
    writeFileSync(path.join(store, "package"), "cached");
    const first = restoreCacheSnapshot(metadata, cache);
    expect(first.hit).toBe(false);
    expect(existsSync(cache)).toBe(false); // Restore-only does not create a cache.
    first.save();
    rmSync(store, { recursive: true });
    expect(restoreCacheSnapshot(metadata, cache).hit).toBe(true);
    expect(readFileSync(path.join(store, "package"), "utf8")).toBe("cached");
  });

  it("restores compatible fallback data but reports a miss for changed lock files", () => {
    const { store, cache, lockFile, metadata } = fixture();
    writeFileSync(path.join(store, "package"), "cached");
    restoreCacheSnapshot(metadata, cache).save();
    writeFileSync(lockFile, "second lock");
    rmSync(store, { recursive: true });
    expect(restoreCacheSnapshot(metadata, cache).hit).toBe(false);
    expect(readFileSync(path.join(store, "package"), "utf8")).toBe("cached");
    expect(restoreCacheSnapshot({ ...metadata, lockType: "yarn" }, cache).hit).toBe(false);
  });

  it("post-save includes packages added by later job scripts without restoring stale files", () => {
    const { store, cache, metadata } = fixture();
    writeFileSync(path.join(store, "package"), "before");
    restoreCacheSnapshot(metadata, cache).save();
    writeFileSync(path.join(store, "package"), "after");
    restoreCacheSnapshot(metadata, cache, undefined, false).save();
    rmSync(store, { recursive: true });
    restoreCacheSnapshot(metadata, cache);
    expect(readFileSync(path.join(store, "package"), "utf8")).toBe("after");
  });

  it("skips missing metadata and overlapping paths safely", () => {
    const { root, cache, metadata } = fixture();
    const warn = vi.fn();
    expect(restoreCacheSnapshot({ ready: false }, cache).hit).toBe(false);
    restoreCacheSnapshot({ ...metadata, cachePath: root }, cache, warn).save();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("overlaps"));
    expect(existsSync(cache)).toBe(false);
  });
});
