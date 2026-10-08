import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

// Supply the reviewed upstream commit explicitly. Never resolve a moving ref
// while installing Vite+: these checksums are part of the setup-vp release.
const [version, commit, flag] = process.argv.slice(2);
if (
  !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version ?? "") ||
  !/^[0-9a-f]{40}$/.test(commit ?? "") ||
  (flag !== undefined && flag !== "--default")
) {
  throw new Error(
    "Usage: node scripts/update-installer-checksums.mjs <version> <reviewed-commit-sha> [--default]",
  );
}

const manifestPath = new URL("../src/ci/installer-checksums.json", import.meta.url);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const checksums = {};
for (const extension of ["sh", "ps1"]) {
  const url = `https://raw.githubusercontent.com/voidzero-dev/vite-plus/${commit}/packages/cli/install.${extension}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000), redirect: "error" });
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0) throw new Error(`Empty installer: ${url}`);
  checksums[extension] = createHash("sha256").update(bytes).digest("hex");
  if (bytes.includes(`install-legacy.${extension}`)) {
    const legacyUrl = url.replace(`install.${extension}`, `install-legacy.${extension}`);
    const legacy = await fetch(legacyUrl, {
      signal: AbortSignal.timeout(15_000),
      redirect: "error",
    });
    if (!legacy.ok) throw new Error(`Download failed (${legacy.status}): ${legacyUrl}`);
    const legacyBytes = Buffer.from(await legacy.arrayBuffer());
    if (legacyBytes.length === 0) throw new Error(`Empty installer: ${legacyUrl}`);
    checksums[`legacy_${extension}`] = createHash("sha256").update(legacyBytes).digest("hex");
  }
}
manifest.releases[version] = { commit, ...checksums };
if (flag === "--default") manifest.defaultVersion = version;
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
