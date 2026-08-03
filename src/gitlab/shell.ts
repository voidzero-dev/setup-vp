import { writeFileSync } from "node:fs";
export { commandPath, run } from "../ci/process.js";

export function shellQuote(value: string): string {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

export function exportShellEnv(
  name: string,
  value: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!env.SETUP_VP_ENV_FILE || value === undefined) return;
  writeFileSync(env.SETUP_VP_ENV_FILE, `export ${name}=${shellQuote(value)}\n`, {
    encoding: "utf8",
    flag: "a",
  });
}
