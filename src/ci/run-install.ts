import path from "node:path";
import { run } from "./process.js";
import type { InstallCommand, RunInstallEntry } from "./types.js";

function parseScalar(value: string): string {
  const trimmed = String(value || "").trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function parseFlowArray(value: string): string[] {
  const trimmed = String(value || "").trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    throw new Error(`args must be an array, got: ${value}`);
  }

  const body = trimmed.slice(1, -1).trim();
  if (!body) return [];

  const result: string[] = [];
  let current = "";
  let quote = "";
  let hasItem = false;

  const pushCurrent = (): void => {
    if (!current.trim()) {
      throw new Error("args flow array entries must be non-empty strings");
    }
    result.push(parseScalar(current));
    current = "";
    hasItem = true;
  };

  for (const char of body) {
    if (quote) {
      if (char === quote) quote = "";
      current += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      current += char;
      continue;
    }
    if (char === ",") {
      pushCurrent();
      continue;
    }
    current += char;
  }

  if (quote) {
    throw new Error("unterminated quoted string in args flow array");
  }

  if (current.trim()) {
    pushCurrent();
  } else if (!hasItem) {
    throw new Error("args flow array entries must be non-empty strings");
  }

  return result;
}

function parseKeyValue(line: string): [string, string] | undefined {
  const index = line.indexOf(":");
  if (index < 0) return undefined;
  return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
}

function countIndent(line: string): number {
  return line.length - line.trimStart().length;
}

function parseBlockArray(
  lines: string[],
  startIndex: number,
  parentIndent: number,
): { values: string[]; nextIndex: number } {
  const values: string[] = [];
  let index = startIndex;

  while (index < lines.length) {
    const rawLine = lines[index];
    const indent = countIndent(rawLine);
    const trimmedStart = rawLine.trimStart();
    if (indent <= parentIndent) break;
    if (!trimmedStart.startsWith("-")) {
      throw new Error(`invalid args line: ${rawLine}`);
    }

    const value = trimmedStart.slice(1).trim();
    if (!value) {
      throw new Error(`args entries must be strings: ${rawLine}`);
    }
    values.push(parseScalar(value));
    index += 1;
  }

  if (values.length === 0) {
    throw new Error("args must be an array");
  }

  return { values, nextIndex: index };
}

function assignValue(target: RunInstallEntry, key: string, value: string): boolean {
  if (key === "cwd") {
    target.cwd = parseScalar(value);
    return false;
  }
  if (key === "args") {
    if (!value) return true;
    target.args = parseFlowArray(value);
    return false;
  }
  throw new Error(`unsupported run-install key: ${key}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateRunInstallEntry(value: unknown): RunInstallEntry {
  if (!isRecord(value)) {
    throw new Error("run-install entries must be objects");
  }

  for (const key of Object.keys(value)) {
    if (key !== "cwd" && key !== "args") {
      throw new Error(`unsupported run-install key: ${key}`);
    }
  }

  const entry: RunInstallEntry = {};
  if (value.cwd !== undefined) {
    if (typeof value.cwd !== "string") {
      throw new Error("run-install.cwd must be a string");
    }
    entry.cwd = value.cwd;
  }

  if (value.args !== undefined) {
    if (!Array.isArray(value.args) || value.args.some((arg) => typeof arg !== "string")) {
      throw new Error("run-install.args must be an array of strings");
    }
    entry.args = value.args;
  }

  return entry;
}

function validateRunInstallInput(value: unknown): import("./types.js").RunInstallInput {
  if (value === null || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(validateRunInstallEntry);
  return validateRunInstallEntry(value);
}

function applyEntryLine(
  target: RunInstallEntry,
  text: string,
  lines: string[],
  index: number,
  parentIndent: number,
  rawLine: string,
): number {
  const entry = parseKeyValue(text);
  if (!entry) throw new Error(`invalid run-install line: ${rawLine}`);
  if (assignValue(target, entry[0], entry[1])) {
    const parsed = parseBlockArray(lines, index + 1, parentIndent);
    target.args = parsed.values;
    return parsed.nextIndex - 1;
  }
  return index;
}

function parseObject(lines: string[]): RunInstallEntry {
  const item: RunInstallEntry = {};
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    index = applyEntryLine(item, line, lines, index, countIndent(rawLine), rawLine);
  }
  return item;
}

export function parseYamlSubset(value: string): RunInstallEntry[] {
  const lines = value.split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith("#"));
  if (lines.length === 0) return [];

  if (!lines[0].trimStart().startsWith("-")) {
    return [parseObject(lines)];
  }

  const topLevelIndent = countIndent(lines[0]);
  const items: RunInstallEntry[] = [];
  let current: RunInstallEntry | undefined = undefined;
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const indent = countIndent(rawLine);
    const trimmedStart = rawLine.trimStart();
    if (indent === topLevelIndent && trimmedStart.startsWith("-")) {
      if (current) items.push(current);
      current = {};
      const rest = trimmedStart.slice(1).trim();
      if (rest) {
        index = applyEntryLine(current, rest, lines, index, indent, rawLine);
      }
      continue;
    }

    if (!current) throw new Error(`invalid run-install line: ${rawLine}`);
    index = applyEntryLine(current, trimmedStart, lines, index, indent, rawLine);
  }
  if (current) items.push(current);
  return items;
}

export function parseRunInstall(value: string): RunInstallEntry[] {
  const input = String(value || "").trim();
  if (!input) return [];

  const parsed = parseRunInstallInput(input);
  return normalizeRunInstallInput(parsed);
}

function parseRunInstallInput(input: string): import("./types.js").RunInstallInput {
  try {
    return validateRunInstallInput(JSON.parse(input));
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw formatRunInstallError(error);
  }

  try {
    return validateRunInstallInput(parseYamlSubset(input));
  } catch (error) {
    throw formatRunInstallError(error);
  }
}

function normalizeRunInstallInput(input: import("./types.js").RunInstallInput): RunInstallEntry[] {
  if (!input) return [];
  if (input === true) return [{}];
  return Array.isArray(input) ? input : [input];
}

function formatRunInstallError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(String(error));
}

export function runInstall(
  entries: RunInstallEntry[],
  projectDir: string,
  installCommand: InstallCommand,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const installEnv = { ...env };
  delete installEnv.SETUP_VP_ENV_FILE;

  for (const entry of entries) {
    const cwd = entry.cwd ? path.resolve(projectDir, entry.cwd) : projectDir;
    const installArgs = ["install", ...(entry.args || [])];
    const args = installCommand === "sfw" ? ["vp", ...installArgs] : installArgs;
    console.log(`setup-vp: running ${installCommand} ${args.join(" ")} in ${cwd}`);
    run(installCommand, args, { cwd, env: installEnv });
  }
}
