import { describe, expect, it } from "vite-plus/test";
import { mkdir, mkdtemp, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { withVitePlusInstallLock } from "./install-lock.js";

describe("withVitePlusInstallLock", () => {
  it("serializes concurrent installs that share a Vite+ home", async () => {
    const root = await mkdtemp(join(tmpdir(), "setup-vp-lock-"));
    let active = 0;
    let maxActive = 0;

    try {
      await Promise.all(
        Array.from({ length: 3 }, () =>
          withVitePlusInstallLock(join(root, ".vite-plus"), async () => {
            active++;
            maxActive = Math.max(maxActive, active);
            await sleep(10);
            active--;
          }),
        ),
      );

      expect(maxActive).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("recovers a stale lock that was interrupted before owner metadata existed", async () => {
    const root = await mkdtemp(join(tmpdir(), "setup-vp-lock-"));
    const vitePlusHome = join(root, ".vite-plus");
    const lockPath = `${vitePlusHome}.setup-vp-lock`;
    const old = new Date(Date.now() - 31 * 60 * 1000);

    try {
      await mkdir(lockPath, { recursive: true });
      await utimes(lockPath, old, old);

      await expect(withVitePlusInstallLock(vitePlusHome, async () => "recovered")).resolves.toBe(
        "recovered",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
