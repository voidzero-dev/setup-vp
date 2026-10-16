import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { validRange } from "semver";

/** Read a bootstrap selector using Vite+'s project-file order, without changing the project. */
export function resolveProjectNodeVersion(projectDir: string): string | undefined {
  let directory = resolve(projectDir);
  for (;;) {
    const nodeVersion = read(join(directory, ".node-version"))?.split("\n")[0]?.trim();
    const [runtime, engine] = packageVersions(read(join(directory, "package.json")));
    const nvmrc = parseNvmrc(read(join(directory, ".nvmrc")));
    const candidates = [nodeVersion, runtime, engine, nvmrc];
    for (const candidate of candidates) {
      const version = normalize(candidate);
      if (version) return version;
    }
    // An invalid declaration falls back to LTS, not a different parent project.
    if (runtime !== undefined || candidates.some((value) => value !== undefined && value !== ""))
      return undefined;
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

function read(file: string): string | undefined {
  try {
    return readFileSync(file, "utf8");
  } catch {
    // Discovery is optional; explicit node-version-file inputs are checked separately.
    return undefined;
  }
}

function packageVersions(content?: string): [string | undefined, string | undefined] {
  try {
    const pkg = JSON.parse(content || "{}");
    const runtime = pkg?.devEngines?.runtime;
    const entries = Array.isArray(runtime) ? runtime : [runtime];
    const version = entries.find((entry) => entry?.name === "node")?.version;
    const engine = pkg?.engines?.node;
    return [
      typeof version === "string" ? version : undefined,
      typeof engine === "string" ? engine : undefined,
    ];
  } catch {
    return [undefined, undefined];
  }
}

function parseNvmrc(content?: string): string | undefined {
  const lines = content
    ?.split("\n")
    .map((line) => line.split("#")[0]!.trim())
    .filter((line) => line && !line.includes("="));
  if (lines?.length !== 1) return undefined;
  const version = lines[0]!;
  if (["iojs", "system", "default"].includes(version)) return undefined;
  return version === "node" || version === "stable" ? "latest" : version;
}

function normalize(value?: string): string | undefined {
  const version = value?.trim().replace(/^v/, "");
  if (!version) return undefined;
  if (/^(?:lts|latest|lts\/(?:\*|[a-z]+|-\d+))$/i.test(version) || validRange(version))
    return version;
  return undefined;
}
