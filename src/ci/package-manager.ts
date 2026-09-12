import { parse as parseYaml } from "yaml";
import { supportsScopedEnv } from "./node-manager.js";

const PACKAGE_MANAGERS = ["npm", "pnpm", "yarn", "bun"] as const;
type PackageManager = (typeof PACKAGE_MANAGERS)[number];
export type PackageManagerConfig = boolean | Partial<Record<PackageManager, boolean>>;

export function parsePackageManager(input: string | undefined): PackageManagerConfig {
  if (!input?.trim()) return true;

  let parsed: unknown;
  try {
    parsed = parseYaml(input);
  } catch (error) {
    throw new Error(`Invalid package-manager input: ${String(error)}`);
  }
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
  config: PackageManagerConfig = true,
  versionOutput: string,
): string[][] {
  if (!supportsScopedEnv(versionOutput)) {
    // Older versions have no separate package-manager mode. Preserve their
    // default behavior, but never silently ignore a requested opt-out.
    if (config === false || (typeof config === "object" && Object.values(config).includes(false))) {
      throw new Error("package-manager opt-outs require Vite+ 0.3.1 or newer.");
    }
    return [];
  }
  if (typeof config === "boolean") return [["env", config ? "on" : "off", "pm"]];

  // Reset all families first so omitted entries default to enabled even on
  // self-hosted runners with choices left over from an earlier job.
  return [
    ["env", "on", "pm"],
    ...PACKAGE_MANAGERS.filter((name) => config[name] === false).map((name) => [
      "env",
      "off",
      name,
    ]),
  ];
}
