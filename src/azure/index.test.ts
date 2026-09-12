import { describe, expect, it, vi } from "vite-plus/test";
import { runFinalize, runPrepare } from "./index.js";

describe("Azure lifecycle", () => {
  it("runs prepare in install → cache order", async () => {
    const calls: string[] = [];
    await runPrepare(
      {
        SETUP_VP_VERSION: "latest",
        SETUP_VP_CACHE: "true",
        SYSTEM_DEFAULTWORKINGDIRECTORY: process.cwd(),
      },
      {
        installVitePlus: async () => {
          calls.push("install");
        },
        prepareCacheMetadata: () => {
          calls.push("cache");
          return { ready: false };
        },
        configureAuth: () => undefined,
        setupSfw: async () => "vp",
        parseRunInstall: () => [],
        runInstall: () => undefined,
        getCommandOutput: () => "vp v0.2.2",
        run: () => undefined,
        parseInstalledVpVersion: () => "0.2.2",
        prependPath: () => undefined,
        setVariable: () => undefined,
        logWarning: () => undefined,
        logInfo: () => undefined,
      },
    );

    expect(calls).toEqual(["install", "cache"]);
  });

  it("runs finalize in auth → sfw → install → version order", async () => {
    const calls: string[] = [];
    await runFinalize(
      {
        SETUP_VP_RUN_INSTALL: "true",
        SYSTEM_DEFAULTWORKINGDIRECTORY: process.cwd(),
      },
      {
        installVitePlus: async () => undefined,
        prepareCacheMetadata: () => ({ ready: false }),
        configureAuth: () => {
          calls.push("auth");
          return undefined;
        },
        setupSfw: async () => {
          calls.push("sfw");
          return "vp";
        },
        parseRunInstall: () => {
          calls.push("parse");
          return [{}];
        },
        runInstall: () => {
          calls.push("install");
        },
        getCommandOutput: () => {
          calls.push("version");
          return "vp v0.2.2";
        },
        run: () => undefined,
        parseInstalledVpVersion: () => "0.2.2",
        prependPath: () => undefined,
        setVariable: () => undefined,
        logWarning: () => undefined,
        logInfo: () => undefined,
      },
    );

    expect(calls).toEqual(["auth", "parse", "sfw", "install", "version"]);
  });

  it.each(["0.3.0", "0.3.1"])("prepare disables only Node.js on Vite+ %s", async (version) => {
    const run = vi.fn();
    await runPrepare(
      {
        SETUP_VP_VERSION: "latest",
        SETUP_VP_NODE_MANAGER: "false",
        SYSTEM_DEFAULTWORKINGDIRECTORY: process.cwd(),
      },
      {
        installVitePlus: async () => undefined,
        prepareCacheMetadata: () => ({ ready: false }),
        configureAuth: () => undefined,
        setupSfw: async () => "vp",
        parseRunInstall: () => [],
        runInstall: () => undefined,
        getCommandOutput: () => `vp v${version}`,
        run,
        parseInstalledVpVersion: () => "0.2.2",
        prependPath: () => undefined,
        setVariable: () => undefined,
        logWarning: () => undefined,
        logInfo: () => undefined,
      },
    );

    expect(run).toHaveBeenCalledWith(
      "vp",
      version === "0.3.0" ? ["env", "off"] : ["env", "off", "node"],
    );
  });

  it("prepare leaves the node manager alone when nodeManager is unset", async () => {
    const run = vi.fn();
    await runPrepare(
      {
        SETUP_VP_VERSION: "latest",
        SYSTEM_DEFAULTWORKINGDIRECTORY: process.cwd(),
      },
      {
        installVitePlus: async () => undefined,
        prepareCacheMetadata: () => ({ ready: false }),
        configureAuth: () => undefined,
        setupSfw: async () => "vp",
        parseRunInstall: () => [],
        runInstall: () => undefined,
        getCommandOutput: () => "vp v0.2.2",
        run,
        parseInstalledVpVersion: () => "0.2.2",
        prependPath: () => undefined,
        setVariable: () => undefined,
        logWarning: () => undefined,
        logInfo: () => undefined,
      },
    );

    expect(run).not.toHaveBeenCalled();
  });

  it("skips install when runInstall is false", async () => {
    const runInstall = vi.fn();
    await runFinalize(
      {
        SETUP_VP_RUN_INSTALL: "false",
        SYSTEM_DEFAULTWORKINGDIRECTORY: process.cwd(),
      },
      {
        installVitePlus: async () => undefined,
        prepareCacheMetadata: () => ({ ready: false }),
        configureAuth: () => undefined,
        setupSfw: async () => "vp",
        parseRunInstall: () => [],
        runInstall,
        getCommandOutput: () => "vp v0.2.2",
        run: () => undefined,
        parseInstalledVpVersion: () => "0.2.2",
        prependPath: () => undefined,
        setVariable: () => undefined,
        logWarning: () => undefined,
        logInfo: () => undefined,
      },
    );

    expect(runInstall).not.toHaveBeenCalled();
  });
});
