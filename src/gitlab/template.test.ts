import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import { parseAllDocuments } from "yaml";

function readTemplate(name: string) {
  const text = readFileSync(new URL("../../gitlab/" + name, import.meta.url), "utf8");
  const docs = parseAllDocuments(text, {
    customTags: [{ tag: "!reference", collection: "seq", resolve: (value) => value }],
  });
  expect(docs.flatMap((doc) => doc.errors)).toEqual([]);
  return { text, inputs: docs[0]!.toJSON().spec.inputs, jobs: docs[1]!.toJSON() };
}

describe("GitLab native templates", () => {
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
