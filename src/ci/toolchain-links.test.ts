import { afterEach, beforeEach, expect, it } from "vite-plus/test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordToolchainLinks, restoreToolchainLinks } from "./toolchain-links.js";

let root: string;
let payload: string;
let link: string;
let target: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "toolchain-links-"));
  payload = join(root, "payload");
  target = join(payload, "node_modules/.pnpm/package");
  link = join(payload, "node_modules/package");
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, "index.js"), "module.exports = 42;");
  symlinkSync(target, link, "junction");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

it("recreates archived junctions from relative metadata", () => {
  recordToolchainLinks(payload);
  rmSync(link);
  symlinkSync(join(root, "missing"), link, "junction");
  restoreToolchainLinks(payload);
  expect(realpathSync(link)).toBe(realpathSync(target));
  expect(readFileSync(join(link, "index.js"), "utf8")).toBe("module.exports = 42;");
  expect(existsSync(join(payload, ".setup-vp-cache-links.json"))).toBe(false);
});

it("removes temporary metadata after saving without changing the links", () => {
  const cleanup = recordToolchainLinks(payload);
  cleanup();
  expect(realpathSync(link)).toBe(realpathSync(target));
  expect(existsSync(join(payload, ".setup-vp-cache-links.json"))).toBe(false);
});

it("rejects links to files outside the payload", () => {
  rmSync(link);
  symlinkSync(root, link, "junction");
  expect(() => recordToolchainLinks(payload)).toThrow("Unsupported toolchain link");
});

it("rejects restored metadata that escapes the payload", () => {
  writeFileSync(
    join(payload, ".setup-vp-cache-links.json"),
    JSON.stringify([["node_modules/package", ".."]]),
  );
  expect(() => restoreToolchainLinks(payload)).toThrow("escapes its payload");
  expect(realpathSync(link)).toBe(realpathSync(target));
});

it("does not replace a regular directory from a malformed cache", () => {
  recordToolchainLinks(payload);
  rmSync(link);
  mkdirSync(link);
  expect(() => restoreToolchainLinks(payload)).toThrow("Invalid toolchain junction");
});

it("preserves a pre-existing file at the metadata path", () => {
  const manifest = join(payload, ".setup-vp-cache-links.json");
  writeFileSync(manifest, "existing");
  expect(() => recordToolchainLinks(payload)).toThrow();
  expect(readFileSync(manifest, "utf8")).toBe("existing");
});
