import { describe, expect, it } from "vite-plus/test";
import type { InstallCommand, RunInstallEntry, RunInstallInput, RuntimeEnv } from "./types.js";

function acceptInstallCommand(command: InstallCommand): InstallCommand {
  return command;
}

describe("GitLab runtime types", () => {
  it("keeps the runtime type contracts narrow", () => {
    const entries: RunInstallEntry[] = [{ cwd: "app", args: ["--prod"] }];
    const input: RunInstallInput = entries;
    const env: RuntimeEnv = { SETUP_VP_SFW: "true" };

    expect(acceptInstallCommand("vp")).toBe("vp");
    expect(acceptInstallCommand("sfw")).toBe("sfw");
    expect(input).toEqual(entries);
    expect(env.SETUP_VP_SFW).toBe("true");
  });
});
