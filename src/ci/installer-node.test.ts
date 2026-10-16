import { describe, expect, it } from "vite-plus/test";
import { existsSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createInstallerNodeContext } from "./installer-node.js";

describe("installer Node selection", () => {
  it("uses the installer's exact result and removes all temporary state", () => {
    const context = createInstallerNodeContext("22");
    const file = context.env.VP_SETUP_NODE_VERSION_FILE;
    try {
      expect(context.env.VP_SETUP_NODE_VERSION).toBe("22");
      expect(context.resolvedVersion()).toBeUndefined();
      writeFileSync(file, "22.23.1\n");
      expect(context.resolvedVersion()).toBe("22.23.1");
      context.reset();
      expect(context.resolvedVersion()).toBeUndefined();
    } finally {
      context.dispose();
    }
    expect(existsSync(dirname(file))).toBe(false);
  });

  it.each([undefined, false])(
    "keeps automatic selection scoped to the project (management: %s)",
    (manager) => {
      const context = createInstallerNodeContext(undefined, manager);
      try {
        expect(context.env.VP_SETUP_NODE_VERSION).toBe(manager === false ? "lts" : "");
        writeFileSync(context.env.VP_SETUP_NODE_VERSION_FILE, "22.23.1");
        expect(context.resolvedVersion()).toBeUndefined();
      } finally {
        context.dispose();
      }
    },
  );

  it.each(["22", "lts/*", "22.23.1\n24.11.0", "../22.23.1"])(
    "rejects an invalid resolved version: %s",
    (version) => {
      const context = createInstallerNodeContext("22");
      try {
        writeFileSync(context.env.VP_SETUP_NODE_VERSION_FILE, version);
        expect(() => context.resolvedVersion()).toThrow("Invalid Node.js version");
      } finally {
        context.dispose();
      }
    },
  );
});
