import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { delimiter, join } from "node:path";

const output = execFileSync(process.platform === "win32" ? "vp.exe" : "vp", [], {
  env: { ...process.env, VP_DUMP_DIRS: "1" },
  encoding: "utf8",
});
const dirs = new Map(
  output
    .trim()
    .split(/\r?\n/)
    .map((line) => line.split("\t")),
);
const fallbackBin = join(dirs.get("data"), "fallback-bin");
const entries = process.env.PATH.split(delimiter);

// The node shim can prepend its selected runtime before executing this script.
assert.ok(entries.includes(dirs.get("bin")), "The main bin directory must be on PATH");
assert.equal(entries.at(-1), fallbackBin, "Fallback shims must be last on PATH");
assert.equal(entries.filter((entry) => entry === fallbackBin).length, 1);
console.log("Fallback shims follow the main bin and system tools on PATH.");
