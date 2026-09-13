import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Exercise the shipped GitLab runtime, without installing dependencies or Vite+.
const runtime = path.resolve(
  process.env.SETUP_VP_TEST_RUNTIME ||
    fileURLToPath(new URL("../dist/gitlab/index.mjs", import.meta.url)),
);

function hash(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

for (const withSymlink of [false, true]) {
  const label = withSymlink ? "Bun directory symlinks" : "regular files (control)";
  await test(`repeated cache saves update the lock hash: ${label}`, () => {
    // Bun's index links use absolute targets. Canonicalize /tmp aliases so the
    // test cannot accidentally hide identical-target symlink copy failures.
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), "setup-vp-cache-regression-")));
    try {
      const store = path.join(root, "store");
      const packageDir = path.join(store, "sample@1.0.0@@@1");
      const lockFile = path.join(root, "bun.lock");
      const manifest = path.join(
        root,
        ".setup-vp-cache",
        process.platform,
        process.arch,
        "bun",
        "lock-hash",
      );
      mkdirSync(packageDir, { recursive: true });
      writeFileSync(path.join(packageDir, "package.json"), '{"name":"sample","version":"1.0.0"}');
      if (withSymlink) {
        const index = path.join(store, "sample");
        mkdirSync(index);
        symlinkSync(packageDir, path.join(index, "1.0.0@@@1"), "dir");
      }
      writeFileSync(lockFile, '{"lockfileVersion":1}\n');
      writeFileSync(
        path.join(root, ".setup-vp-cache-state.json"),
        JSON.stringify({ ready: true, cachePath: store, lockFile, lockType: "bun" }),
      );

      const save = () => {
        const result = spawnSync(process.execPath, [runtime, "save-cache"], {
          cwd: root,
          env: { ...process.env, CI_PROJECT_DIR: root },
          encoding: "utf8",
          timeout: 10_000,
        });
        assert.ifError(result.error);
        assert.equal(result.status, 0, result.stderr);
        return result;
      };

      const firstHash = hash(lockFile);
      const first = save();
      assert.equal(first.stderr, "", "The initial snapshot must save without warnings");
      assert.equal(readFileSync(manifest, "utf8"), firstHash);

      // Model a job script changing the lockfile before the after_script save.
      writeFileSync(lockFile, '{"lockfileVersion":1,"packages":{"added":"1.0.0"}}\n');
      const secondHash = hash(lockFile);
      assert.notEqual(secondHash, firstHash);
      const second = save();
      if (second.stderr) console.error(second.stderr.trim());

      // save-cache currently catches copy errors and exits 0. Check the actual
      // snapshot, so the job fails even if its runtime exit code is successful.
      assert.equal(
        readFileSync(manifest, "utf8"),
        secondHash,
        "The second snapshot must record the changed lockfile hash",
      );
      assert.equal(second.stderr, "", "Repeated saves must not emit cache copy warnings");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
