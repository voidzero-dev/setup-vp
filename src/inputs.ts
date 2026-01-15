import { getInput, getBooleanInput } from "@actions/core";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import type { Inputs, RunInstall } from "./types.js";
import { RunInstallInputSchema } from "./types.js";

export function getInputs(): Inputs {
  return {
    version: getInput("version") || "latest",
    runInstall: parseRunInstall(getInput("run-install")),
    cache: getBooleanInput("cache"),
    cacheDependencyPath: getInput("cache-dependency-path") || undefined,
  };
}

function parseRunInstall(input: string): RunInstall[] {
  if (!input || input === "false" || input === "null") {
    return [];
  }

  // Handle boolean true
  if (input === "true") {
    return [{}];
  }

  // Parse YAML/JSON input
  const parsed: unknown = parseYaml(input);

  try {
    const result = RunInstallInputSchema.parse(parsed);
    if (!result) return [];
    if (result === true) return [{}];
    if (Array.isArray(result)) return result;
    return [result];
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(
        `Invalid run-install input: ${error.errors.map((e) => e.message).join(", ")}`,
      );
    }
    throw error;
  }
}
