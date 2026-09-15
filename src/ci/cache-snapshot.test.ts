import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
  lstatSync,
  realpathSync,
  readlinkSync,
  renameSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { restoreCacheSnapshot } from "./cache-snapshot.js";

const directories: string[] = [];
afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function fixture() {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "setup-vp-cache-")));
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

  it.each(["absolute", "relative"])(
    "saves and restores Bun-style %s directory symlinks repeatedly",
    (targetKind) => {
      const { store, cache, lockFile, metadata } = fixture();
      metadata.lockType = "bun";
      const packageDir = path.join(store, "sample@1.0.0@@@1");
      const index = path.join(store, "sample");
      const link = path.join(index, "1.0.0@@@1");
      const cached = path.join(cache, process.platform, process.arch, "bun");
      const cachedLink = path.join(cached, "packages", "sample", "1.0.0@@@1");
      const warn = vi.fn();
      mkdirSync(packageDir);
      mkdirSync(index);
      writeFileSync(path.join(packageDir, "package.json"), "before");
      symlinkSync(
        targetKind === "absolute" ? packageDir : path.relative(index, packageDir),
        link,
        process.platform === "win32" ? "junction" : "dir",
      );

      restoreCacheSnapshot(metadata, cache, warn).save();
      writeFileSync(path.join(packageDir, "package.json"), "after");
      writeFileSync(lockFile, "second lock");
      restoreCacheSnapshot(metadata, cache, warn, false).save();

      expect(warn).not.toHaveBeenCalled();
      expect(readFileSync(path.join(cached, "lock-hash"), "utf8")).toBe(
        createHash("sha256").update("second lock").digest("hex"),
      );
      expect(
        readFileSync(path.join(cached, "packages", "sample@1.0.0@@@1", "package.json"), "utf8"),
      ).toBe("after");
      expect(lstatSync(cachedLink).isSymbolicLink()).toBe(true);
      expect(realpathSync(cachedLink)).toBe(
        realpathSync(path.join(cached, "packages", "sample@1.0.0@@@1")),
      );

      // A warm store must retain its current entries, including its symlinks.
      writeFileSync(path.join(packageDir, "package.json"), "local");
      expect(restoreCacheSnapshot(metadata, cache, warn).hit).toBe(true);
      expect(readFileSync(path.join(packageDir, "package.json"), "utf8")).toBe("local");
      expect(realpathSync(link)).toBe(realpathSync(packageDir));
      expect(warn).not.toHaveBeenCalled();
    },
  );

  it.each(["absolute", "relative"])(
    "relocates %s links when snapshot and store roots both change",
    (targetKind) => {
      const { root, store, cache, metadata } = fixture();
      const packageDir = path.join(store, "package");
      const index = path.join(store, "index");
      mkdirSync(packageDir);
      mkdirSync(index);
      writeFileSync(path.join(packageDir, "value"), "cached package");
      symlinkSync(
        targetKind === "absolute" ? packageDir : "../package",
        path.join(index, "link"),
        process.platform === "win32" ? "junction" : "dir",
      );
      const warn = vi.fn();
      restoreCacheSnapshot(metadata, cache, warn).save();
      const movedCache = path.join(root, "another-runner-snapshot");
      const movedStore = path.join(root, "another-runner-store");
      renameSync(cache, movedCache);
      rmSync(store, { recursive: true });
      expect(
        restoreCacheSnapshot({ ...metadata, cachePath: movedStore }, movedCache, warn).hit,
      ).toBe(true);
      const restoredLink = path.join(movedStore, "index/link");
      expect(readFileSync(path.join(restoredLink, "value"), "utf8")).toBe("cached package");
      expect(readlinkSync(restoredLink)).toBe(path.join("..", "package"));
      expect(warn).not.toHaveBeenCalled();
    },
  );

  it("hashes the current lockfile when saving the setup-phase snapshot", () => {
    const { store, cache, lockFile, metadata } = fixture();
    writeFileSync(path.join(store, "package"), "cached");
    const snapshot = restoreCacheSnapshot(metadata, cache);
    writeFileSync(lockFile, "changed during install");
    snapshot.save();
    expect(restoreCacheSnapshot(metadata, cache).hit).toBe(true);
  });

  it.each(["file", "directory"])("replaces a cached %s with a symlink on save", (entryKind) => {
    const { store, cache, lockFile, metadata } = fixture();
    const entry = path.join(store, "entry");
    const target = path.join(store, "target");
    const cached = path.join(cache, process.platform, process.arch, "npm");
    const warn = vi.fn();
    mkdirSync(target);
    writeFileSync(path.join(target, "value"), "new value");
    if (entryKind === "directory") {
      mkdirSync(entry);
      writeFileSync(path.join(entry, "old"), "old value");
    } else {
      writeFileSync(entry, "old value");
    }
    restoreCacheSnapshot(metadata, cache, warn).save();

    rmSync(entry, { recursive: true });
    symlinkSync(target, entry, process.platform === "win32" ? "junction" : "dir");
    writeFileSync(lockFile, "second lock");
    restoreCacheSnapshot(metadata, cache, warn, false).save();

    expect(warn).not.toHaveBeenCalled();
    const cachedEntry = path.join(cached, "packages", "entry");
    expect(lstatSync(cachedEntry).isSymbolicLink()).toBe(true);
    expect(readFileSync(path.join(cachedEntry, "value"), "utf8")).toBe("new value");
    expect(readFileSync(path.join(cached, "lock-hash"), "utf8")).toBe(
      createHash("sha256").update("second lock").digest("hex"),
    );
    rmSync(store, { recursive: true });
    expect(restoreCacheSnapshot(metadata, cache, warn).hit).toBe(true);
    expect(lstatSync(entry).isSymbolicLink()).toBe(true);
    expect(readFileSync(path.join(entry, "value"), "utf8")).toBe("new value");
    expect(warn).not.toHaveBeenCalled();
  });

  it.each(["file", "directory"])(
    "replaces a cached symlink with a %s without modifying its external target",
    (entryKind) => {
      const { root, store, cache, lockFile, metadata } = fixture();
      const entry = path.join(store, "entry");
      const target = path.join(root, "external-target");
      const cached = path.join(cache, process.platform, process.arch, "npm");
      const warn = vi.fn();
      if (entryKind === "directory") {
        mkdirSync(target);
        writeFileSync(path.join(target, "value"), "external value");
        symlinkSync(target, entry, process.platform === "win32" ? "junction" : "dir");
      } else {
        writeFileSync(target, "external value");
        symlinkSync(target, entry, "file");
      }
      restoreCacheSnapshot(metadata, cache, warn).save();

      unlinkSync(entry);
      if (entryKind === "directory") mkdirSync(entry);
      const valuePath = entryKind === "file" ? entry : path.join(entry, "value");
      const externalValuePath = entryKind === "file" ? target : path.join(target, "value");
      writeFileSync(valuePath, "new value");
      writeFileSync(lockFile, "second lock");
      restoreCacheSnapshot(metadata, cache, warn, false).save();

      expect(warn).not.toHaveBeenCalled();
      expect(readFileSync(externalValuePath, "utf8")).toBe("external value");
      const cachedEntry = path.join(cached, "packages", "entry");
      expect(lstatSync(cachedEntry).isSymbolicLink()).toBe(false);
      expect(readFileSync(path.join(cached, "lock-hash"), "utf8")).toBe(
        createHash("sha256").update("second lock").digest("hex"),
      );
      rmSync(store, { recursive: true });
      expect(restoreCacheSnapshot(metadata, cache, warn).hit).toBe(true);
      expect(readFileSync(valuePath, "utf8")).toBe("new value");
      expect(readFileSync(externalValuePath, "utf8")).toBe("external value");
      expect(warn).not.toHaveBeenCalled();
    },
  );

  it("replaces changed symlinks on save without dereferencing their targets", () => {
    const { root, store, cache, metadata } = fixture();
    const link = path.join(store, "link");
    const oldTarget = path.join(root, "old-target");
    const newTarget = path.join(root, "new-target");
    const cachedLink = path.join(cache, process.platform, process.arch, "npm", "packages", "link");
    const warn = vi.fn();
    const linkType = process.platform === "win32" ? "junction" : "dir";
    mkdirSync(oldTarget);
    mkdirSync(newTarget);
    symlinkSync(oldTarget, link, linkType);
    restoreCacheSnapshot(metadata, cache, warn).save();

    unlinkSync(link);
    rmSync(oldTarget, { recursive: true });
    symlinkSync(newTarget, link, linkType);
    restoreCacheSnapshot(metadata, cache, warn, false).save();

    expect(warn).not.toHaveBeenCalled();
    expect(lstatSync(cachedLink).isSymbolicLink()).toBe(true);
    expect(realpathSync(cachedLink)).toBe(realpathSync(newTarget));

    // Restore must not replace an existing link, even if that link is dangling.
    rmSync(newTarget, { recursive: true });
    expect(restoreCacheSnapshot(metadata, cache, warn).hit).toBe(true);
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(warn).not.toHaveBeenCalled();
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
