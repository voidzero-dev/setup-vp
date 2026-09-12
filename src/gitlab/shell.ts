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
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) throw new Error("Invalid environment variable name");
  const line =
    env.SETUP_VP_ENV_FORMAT === "powershell"
      ? `$env:${name} = '${value.replaceAll("'", "''")}'\n`
      : `export ${name}=${shellQuote(value)}\n`;
  writeFileSync(env.SETUP_VP_ENV_FILE, line, {
    encoding: "utf8",
    flag: "a",
  });
}
