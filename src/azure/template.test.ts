import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { parse as parseYaml } from "yaml";

const templatePath = fileURLToPath(new URL("../../azure/setup-vp.yml", import.meta.url));
const template = readFileSync(templatePath, "utf8");
const docs = parseYaml(template);

describe("azure/setup-vp.yml", () => {
  it("declares the documented parameters with defaults", () => {
    const parameters = docs.parameters as Array<{
      name: string;
      type: string;
      default: unknown;
    }>;
    const byName = Object.fromEntries(parameters.map((entry) => [entry.name, entry]));

    expect(byName.version).toMatchObject({ type: "string", default: "latest" });
    expect(byName.workingDirectory).toMatchObject({ type: "string", default: "." });
    expect(byName.runInstall).toMatchObject({ type: "object", default: true });
    expect(byName.sfw).toMatchObject({ type: "boolean", default: false });
    expect(byName.registryUrl).toMatchObject({ type: "string", default: "" });
    expect(byName.scope).toMatchObject({ type: "string", default: "" });
    expect(byName.setupRef).toMatchObject({ type: "string", default: "v1.18.0" });
    expect(byName.nodeVersion).toMatchObject({ type: "string", default: "24.x" });
    expect(byName.nodeManager).toMatchObject({ type: "string", default: "" });
    expect(byName.cache).toMatchObject({ type: "boolean", default: false });
    expect(byName.cacheDependencyPath).toMatchObject({ type: "string", default: "" });
  });

  it("orders UseNode, prepare, Cache@2, and finalize", () => {
    const steps = docs.steps as Array<Record<string, unknown>>;
    const flattened = JSON.stringify(steps);
    expect(flattened).toContain("UseNode@1");
    expect(flattened).toContain("setup-vp prepare");
    expect(flattened).toContain("Cache@2");
    expect(flattened).toContain("setup-vp finalize");
    expect(flattened.indexOf("setup-vp prepare")).toBeLessThan(flattened.indexOf("Cache@2"));
    expect(flattened.indexOf("Cache@2")).toBeLessThan(flattened.indexOf("setup-vp finalize"));
  });

  it("serializes runInstall with convertToJson and avoids main downloads", () => {
    expect(template).toContain("${{ convertToJson(parameters.runInstall) }}");
    expect(template).not.toMatch(/setup-vp\/main\//);
    expect(template).toContain("$(SETUP_VP_LOCK_FILE)");
    expect(template).toContain("cacheHitVar: SETUP_VP_CACHE_HIT");
    expect(template.match(/NODE_AUTH_TOKEN: \$\(NODE_AUTH_TOKEN\)/g) ?? []).toHaveLength(2);
  });

  it("includes Unix and Windows branches", () => {
    expect(template).toContain("Windows_NT");
    expect(template).toContain("bootstrap.sh");
    expect(template).toContain("bootstrap.ps1");
  });

  it("selects the agent shell at runtime", () => {
    expect(template).not.toContain("${{ if eq(variables['Agent.OS'], 'Windows_NT') }}");
    expect(template).not.toContain("${{ if ne(variables['Agent.OS'], 'Windows_NT') }}");
    expect(template).toContain(
      "condition: and(succeeded(), eq(variables['Agent.OS'], 'Windows_NT'))",
    );
    expect(template).toContain(
      "condition: and(succeeded(), ne(variables['Agent.OS'], 'Windows_NT'))",
    );
  });
});
