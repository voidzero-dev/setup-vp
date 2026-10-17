import { afterEach, describe, expect, it } from "vite-plus/test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { resolveProjectNodeVersion } from "./project-node-version.js";
import { createInstallerNodeContext } from "./installer-node.js";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
function fixture(files: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), "setup-vp-project-node-"));
  directories.push(root);
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), content);
  }
  return root;
}

describe("project Node selection for the installer", () => {
  it("checks all sources in a directory before its parent", () => {
    const root = fixture({
      ".node-version": "26.0.0",
      "app/.nvmrc": "v22.18.0 # project pin",
    });
    expect(resolveProjectNodeVersion(join(root, "app"))).toBe("22.18.0");
    rmSync(join(root, "app/.nvmrc"));
    expect(resolveProjectNodeVersion(join(root, "app"))).toBe("26.0.0");
  });

  it("prefers .node-version, then devEngines.runtime, engines.node, and .nvmrc", () => {
    const root = fixture({
      ".node-version": "v22.18.0\n",
      "package.json": JSON.stringify({
        devEngines: {
          runtime: [
            { name: "bun", version: "1" },
            { name: "node", version: "^24.11.0" },
          ],
        },
        engines: { node: ">=26" },
      }),
      ".nvmrc": "lts/*",
    });
    expect(resolveProjectNodeVersion(root)).toBe("22.18.0");
    rmSync(join(root, ".node-version"));
    expect(resolveProjectNodeVersion(root)).toBe("^24.11.0");
    writeFileSync(join(root, "package.json"), '{"engines":{"node":">=26"}}');
    expect(resolveProjectNodeVersion(root)).toBe(">=26");
    writeFileSync(join(root, "package.json"), "{}");
    expect(resolveProjectNodeVersion(root)).toBe("lts/*");
  });

  it.each([
    ['{"devEngines":{"runtime":{"name":"node","version":"22"}}}', "22"],
    ['{"devEngines":{"runtime":{"name":"bun","version":"1"}},"engines":{"node":"24"}}', "24"],
    [
      '{"devEngines":{"runtime":{"name":"node","version":"invalid"}},"engines":{"node":"24"}}',
      "24",
    ],
    ["invalid JSON", "26"],
    ["null", "26"],
  ])("reads package declarations and skips unusable metadata: %s", (content, expected) => {
    const root = fixture({ "package.json": content, ".nvmrc": "26" });
    expect(resolveProjectNodeVersion(root)).toBe(expected);
  });

  it.each([
    ["# comment\nnode\n", "latest"],
    ["stable # comment\n", "latest"],
    ["key=value\nlts/-1\n", "lts/-1"],
    ["22\n24\n", undefined],
    ["system", undefined],
    ["", undefined],
  ])("handles .nvmrc syntax: %s", (content, expected) => {
    expect(resolveProjectNodeVersion(fixture({ ".nvmrc": content }))).toBe(expected);
  });

  it("uses lower-priority valid declarations, but does not inherit past an invalid declaration", () => {
    const root = fixture({
      ".node-version": "26",
      "app/.node-version": "invalid",
      "app/.nvmrc": "22",
    });
    expect(resolveProjectNodeVersion(join(root, "app"))).toBe("22");
    rmSync(join(root, "app/.nvmrc"));
    expect(resolveProjectNodeVersion(join(root, "app"))).toBeUndefined();
  });

  it("does not discover .tool-versions or invent a project version", () => {
    expect(resolveProjectNodeVersion(fixture({ ".tool-versions": "nodejs 22" }))).toBeUndefined();
  });

  it.each([
    [undefined, undefined, "22.18.0"],
    ["24", undefined, "24"],
    [undefined, false, ""],
  ])(
    "passes project discovery only to bootstrap (input: %s, manager: %s)",
    (input, manager, expected) => {
      const root = fixture({ ".node-version": "22.18.0" });
      const context = createInstallerNodeContext(input, manager, root);
      try {
        expect(context.env.VP_SETUP_NODE_VERSION).toBe(expected);
        writeFileSync(context.env.VP_SETUP_NODE_VERSION_FILE, "24.11.0");
        expect(context.resolvedVersion()).toBe(input ? "24.11.0" : undefined);
      } finally {
        context.dispose();
      }
      expect(readFileSync(join(root, ".node-version"), "utf8")).toBe("22.18.0");
    },
  );
});
