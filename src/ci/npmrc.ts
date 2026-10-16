import { readFileSync } from "node:fs";

const LINE_BREAK_RE = /\r?\n/;

export function readNpmrc(file: string): string {
  try {
    return readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

export function analyzeProjectNpmrc(content: string): {
  envVarRefs: Set<string>;
} {
  const envVarRefs = new Set<string>();

  for (const rawLine of content.split(LINE_BREAK_RE)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(";") || line.startsWith("#")) continue;

    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const value = line.slice(eq + 1).trim();

    for (const m of value.matchAll(/\$\{(\w+)\}/g)) {
      envVarRefs.add(m[1]!);
    }
  }

  return {
    envVarRefs,
  };
}
