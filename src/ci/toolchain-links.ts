import {
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const MANIFEST = ".setup-vp-cache-links.json";

function inside(root: string, path: string): boolean {
  const value = relative(root, path);
  return value !== "" && value !== ".." && !value.startsWith(`..${sep}`) && !isAbsolute(value);
}

// GNU tar does not preserve Windows junctions as usable Node.js dependency
// links. Store their relative destinations and recreate them after extraction.
export function recordToolchainLinks(payload: string): () => void {
  const root = realpathSync(payload);
  const links: [string, string][] = [];
  function visit(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        const target = realpathSync(path);
        if (!inside(root, target) || !lstatSync(target).isDirectory()) {
          throw new Error(`Unsupported toolchain link: ${path}`);
        }
        links.push([relative(root, path), relative(root, target)]);
      } else if (entry.isDirectory()) {
        visit(path);
      }
    }
  }
  visit(root);
  const manifest = join(root, MANIFEST);
  writeFileSync(manifest, JSON.stringify(links), { flag: "wx" });
  return () => rmSync(manifest, { force: true });
}

export function restoreToolchainLinks(payload: string): void {
  const root = realpathSync(payload);
  const manifest = join(root, MANIFEST);
  const entries: unknown = JSON.parse(readFileSync(manifest, "utf8"));
  if (!Array.isArray(entries)) throw new Error("Invalid toolchain link manifest");
  for (const entry of entries) {
    if (
      !Array.isArray(entry) ||
      entry.length !== 2 ||
      !entry.every((value) => typeof value === "string")
    ) {
      throw new Error("Invalid toolchain link entry");
    }
    const [linkName, targetName] = entry as [string, string];
    const link = resolve(root, linkName);
    const target = resolve(root, targetName);
    const parent = realpathSync(dirname(link));
    if (
      !inside(root, link) ||
      !inside(root, target) ||
      (parent !== root && !inside(root, parent)) ||
      !inside(root, realpathSync(target))
    ) {
      throw new Error("Toolchain link escapes its payload");
    }
    if (!lstatSync(link).isSymbolicLink() || !lstatSync(target).isDirectory()) {
      throw new Error("Invalid toolchain junction");
    }
    rmSync(link, { force: true });
    symlinkSync(target, link, "junction");
  }
  rmSync(manifest);
}
