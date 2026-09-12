import { parse as parseYaml } from "yaml";
import { supportsScopedEnv } from "./node-manager.js";

const PACKAGE_MANAGERS = ["npm", "pnpm", "yarn", "bun"] as const;
type PackageManager = (typeof PACKAGE_MANAGERS)[number];
export type PackageManagerConfig = boolean | Partial<Record<PackageManager, boolean>>;

export function parsePackageManager(input: string | undefined): PackageManagerConfig | undefined {
  if (!input?.trim()) return undefined;

  let parsed: unknown;
  try {
    parsed = parseYaml(input);
  } catch (error) {
    throw new Error(`Invalid package-manager input: ${String(error)}`);
  }
  // Azure serializes its empty default through convertToJson.
  if (parsed === "") return undefined;
  if (typeof parsed === "boolean") return parsed;
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    for (const [name, enabled] of Object.entries(parsed)) {
      if (!PACKAGE_MANAGERS.includes(name as PackageManager) || typeof enabled !== "boolean") {
        throw new Error(
          `Invalid package-manager input: ${name} must be npm, pnpm, yarn, or bun with a boolean value.`,
        );
      }
    }
    return parsed;
  }
  throw new Error(
    "Invalid package-manager input: expected a boolean or a mapping of npm, pnpm, yarn, and bun to booleans.",
  );
}

export function packageManagerArgs(
  config: PackageManagerConfig | undefined,
  versionOutput: string,
): string[][] {
  if (config === undefined) return [];
  if (!supportsScopedEnv(versionOutput)) {
    throw new Error("package-manager configuration requires Vite+ 0.3.1 or newer.");
  }

  // Installation enables management by default; only apply requested opt-outs.
  if (typeof config === "boolean") return config ? [] : [["env", "off", "pm"]];
  return PACKAGE_MANAGERS.filter((name) => config[name] === false).map((name) => [
    "env",
    "off",
    name,
  ]);
}
