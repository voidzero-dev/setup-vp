import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import { parseAllDocuments } from "yaml";

const { version } = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as { version: string };
const releaseRef = `v${version}`;

function readTemplate(name: string) {
  const text = readFileSync(new URL("../../gitlab/" + name, import.meta.url), "utf8");
  const docs = parseAllDocuments(text, {
    customTags: [{ tag: "!reference", collection: "seq", resolve: (value) => value }],
  });
  expect(docs.flatMap((doc) => doc.errors)).toEqual([]);
  return { text, inputs: docs[0]!.toJSON().spec.inputs, jobs: docs[1]!.toJSON() };
}

describe("GitLab native templates", () => {
  it.each(["setup-vp.yml", "setup-vp-windows.yml"])(
    "%s defaults to the package.json release",
    (name) => {
      const { inputs, jobs } = readTemplate(name);
      expect(inputs["setup-ref"].default).toBe(releaseRef);
      const bootstrap = jobs[".setup-vp-bootstrap"].before_script[0];
      if (name === "setup-vp.yml") {
        expect(bootstrap).toContain(`SETUP_VP_SETUP_REF="\${SETUP_VP_SETUP_REF:-${releaseRef}}"`);
      } else {
        expect(bootstrap).toContain(
          `if (-not $env:SETUP_VP_SETUP_REF) { $env:SETUP_VP_SETUP_REF = '${releaseRef}' }`,
        );
      }
    },
  );

  it("keeps the Unix and Windows input contracts identical", () => {
    const unix = readTemplate("setup-vp.yml");
    const windows = readTemplate("setup-vp-windows.yml");
    expect(windows.inputs).toEqual(unix.inputs);
    expect(unix.inputs.version.default).toBe("");
    for (const key of [
      "version-file",
      "node-version",
      "node-version-file",
      "cache-dependency-path",
    ]) {
      expect(unix.inputs[key].default).toBe("");
      const envName = "SETUP_VP_" + key.toUpperCase().replaceAll("-", "_");
      expect(unix.text).toContain(envName);
      expect(windows.text).toContain(envName);
    }
  });

  it.each(["setup-vp.yml", "setup-vp-windows.yml"])(
    "provides opt-in native cache policy and post-save in %s",
    (name) => {
      const { inputs, jobs } = readTemplate(name);
      expect(inputs["cache-policy"].options).toEqual(["pull", "pull-push"]);
      expect(jobs[".setup-vp"].cache).toBeUndefined();
      const cached = jobs[".setup-vp-cached"];
      expect(cached.extends).toBe(".setup-vp");
      expect(cached.variables.SETUP_VP_CACHE).toBe("true");
      expect(cached.cache.paths).toEqual([".setup-vp-cache/"]);
      expect(cached.cache.policy).toBe("$[[ inputs.cache-policy ]]");
      expect(inputs["cache-namespace"].default).toBe("$CI_RUNNER_ID");
      expect(cached.cache.key).toBe(
        "setup-vp-v2-$[[ inputs.cache-namespace ]]-$CI_JOB_NAME_SLUG-$CI_COMMIT_REF_SLUG",
      );
      expect(cached.cache.fallback_keys).toEqual([
        "setup-vp-v2-$[[ inputs.cache-namespace ]]-$CI_JOB_NAME_SLUG-$CI_DEFAULT_BRANCH",
      ]);
      expect(cached.after_script.join("\n")).toContain("save-cache");
      expect(cached.cache.paths.join("\n")).not.toContain("env");
    },
  );

  it("uses literal PowerShell input strings and sources the generated environment", () => {
    const { jobs } = readTemplate("setup-vp-windows.yml");
    expect(jobs[".setup-vp"].before_script[0]).toContain("\n'@\n");
    const bootstrap = jobs[".setup-vp-bootstrap"].before_script[0];
    expect(bootstrap).toContain("SETUP_VP_ENV_FORMAT = 'powershell'");
    expect(bootstrap).toContain(". $envFile");
    expect(bootstrap).toContain("finally");
  });
});
