import { describe, expect, it } from "vite-plus/test";
import { escapeLoggingCommandData } from "./commands.js";

describe("escapeLoggingCommandData", () => {
  it("escapes characters that could terminate logging commands", () => {
    expect(escapeLoggingCommandData("plain/path")).toBe("plain/path");
    expect(escapeLoggingCommandData("C:\\Users\\dev")).toBe("C:\\Users\\dev");
    expect(escapeLoggingCommandData("a%b")).toBe("a%AZP25b");
    expect(escapeLoggingCommandData("a;b")).toBe("a%3Bb");
    expect(escapeLoggingCommandData("a]b")).toBe("a%5Db");
    expect(escapeLoggingCommandData("a\nb")).toBe("a%0Ab");
    expect(escapeLoggingCommandData("a\rb")).toBe("a%0Db");
    expect(escapeLoggingCommandData("a%;\n]b")).toBe("a%AZP25%3B%0A%5Db");
  });
});

describe("Azure logging commands", () => {
  it("renders prependpath and setvariable commands", async () => {
    const { prependPath, setVariable } = await import("./commands.js");
    const stdout: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdout.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;

    try {
      prependPath("/tmp/vp/bin");
      setVariable("SETUP_VP_INSTALLED_VERSION", "0.2.2", { isOutput: true });
      expect(stdout.join("")).toContain("##vso[task.prependpath]/tmp/vp/bin\n");
      expect(stdout.join("")).toContain(
        "##vso[task.setvariable variable=SETUP_VP_INSTALLED_VERSION;isOutput=true]0.2.2\n",
      );
    } finally {
      process.stdout.write = originalWrite;
    }
  });
});
