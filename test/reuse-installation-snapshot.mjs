import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, readlinkSync, realpathSync } from "node:fs";
import { join } from "node:path";

// Compare the immutable version tree, including dependency links. Runtime and
// configuration files outside this tree can change during normal setup.
const directory = process.argv[2];
if (!directory) throw new Error("Expected an installed version directory");
const root = realpathSync(directory);
const entries = [];
function visit(relative) {
  const path = join(root, relative);
  const stat = lstatSync(path, { bigint: true });
  if (stat.isSymbolicLink()) {
    entries.push([relative, "link", readlinkSync(path)]);
  } else if (stat.isDirectory()) {
    for (const name of readdirSync(path).sort()) visit(join(relative, name));
  } else if (stat.isFile()) {
    entries.push([
      relative,
      "file",
      String(stat.mode),
      String(stat.size),
      String(stat.mtimeNs),
      createHash("sha256").update(readFileSync(path)).digest("hex"),
    ]);
  } else {
    throw new Error(`Unexpected installation entry: ${path}`);
  }
}
visit("");
console.log(JSON.stringify({ root, entries }, null, 2));
