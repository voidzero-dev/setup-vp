import { describe, expect, it } from "vite-plus/test";
import { parseNodeManager } from "./node-manager.js";

describe("parseNodeManager", () => {
  it.each([
    { input: undefined, expected: undefined },
    { input: "", expected: undefined },
    { input: "true", expected: true },
    { input: "false", expected: false },
    // Azure serializes booleans passed to string parameters in title case.
    { input: "True", expected: true },
    { input: "False", expected: false },
    { input: "TRUE", expected: true },
    { input: "FALSE", expected: false },
  ])("parses $input as $expected", ({ input, expected }) => {
    expect(parseNodeManager(input)).toBe(expected);
  });

  it.each(["off", "on", "yes", "no", "0", "1"])("rejects %j", (input) => {
    expect(() => parseNodeManager(input)).toThrow(`Invalid node-manager input: "${input}"`);
  });
});
