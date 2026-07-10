import { describe, expect, it } from "vite-plus/test";
import { parseAzureInputs, resolveProjectDirFromInputs } from "./inputs.js";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

describe("parseAzureInputs", () => {
  it("maps SETUP_VP_* environment variables", () => {
    const inputs = parseAzureInputs({
      SETUP_VP_VERSION: "1.2.3",
      SETUP_VP_WORKING_DIRECTORY: "apps/web",
      SETUP_VP_RUN_INSTALL: "false",
      SETUP_VP_SFW: "true",
      SETUP_VP_REGISTRY_URL: "https://registry.example/npm/",
      SETUP_VP_SCOPE: "@acme",
      SETUP_VP_CACHE: "true",
      SETUP_VP_CACHE_DEPENDENCY_PATH: "pnpm-lock.yaml",
      SYSTEM_DEFAULTWORKINGDIRECTORY: "/workspace",
    });

    expect(inputs).toEqual({
      version: "1.2.3",
      workingDirectory: "apps/web",
      runInstall: "false",
      sfw: true,
      registryUrl: "https://registry.example/npm/",
      scope: "@acme",
      cache: true,
      cacheDependencyPath: "pnpm-lock.yaml",
      workspaceRoot: "/workspace",
    });
  });

  it("accepts Azure's title-cased boolean serialization", () => {
    const inputs = parseAzureInputs({
      SETUP_VP_SFW: "True",
      SETUP_VP_CACHE: "True",
    });

    expect(inputs.sfw).toBe(true);
    expect(inputs.cache).toBe(true);
  });
});

describe("resolveProjectDirFromInputs", () => {
  const tempDirs: string[] = [];

  it("resolves workingDirectory against the Azure workspace root", () => {
    const root = mkdtempSync(path.join(tmpdir(), "setup-vp-azure-"));
    tempDirs.push(root);
    const child = path.join(root, "apps", "web");
    mkdirSync(child, { recursive: true });

    const projectDir = resolveProjectDirFromInputs({
      version: "latest",
      workingDirectory: "apps/web",
      runInstall: "true",
      sfw: false,
      registryUrl: "",
      scope: "",
      cache: false,
      cacheDependencyPath: "",
      workspaceRoot: root,
    });

    expect(projectDir).toBe(child);
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
});
