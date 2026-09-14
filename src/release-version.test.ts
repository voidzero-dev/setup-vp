import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";

const { version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };
const releaseRef = `v${version}`;

describe("release bootstrap defaults", () => {
  it.each(["gitlab/bootstrap.sh", "azure/bootstrap.sh"])(
    "%s defaults to the package.json release",
    (file) => {
      const script = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
      expect(script).toContain(`SETUP_VP_SETUP_REF="\${SETUP_VP_SETUP_REF:-${releaseRef}}"`);
    },
  );

  it.each(["gitlab/bootstrap.ps1", "azure/bootstrap.ps1"])(
    "%s defaults to the package.json release",
    (file) => {
      const script = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
      expect(script).toContain(
        `$setupRef = if ($env:SETUP_VP_SETUP_REF) { $env:SETUP_VP_SETUP_REF } else { '${releaseRef}' }`,
      );
    },
  );
});
