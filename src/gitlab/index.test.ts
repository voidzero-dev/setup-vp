import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { isEntrypoint, main } from "./index.js";

describe("GitLab entrypoint", () => {
  it("exports the GitLab runtime main function", () => {
    expect(main).toBeTypeOf("function");
  });

  it("matches relative argv paths against the resolved module URL", () => {
    const absolutePath = fileURLToPath(new URL("./index.ts", import.meta.url));
    const relativePath = path.relative(process.cwd(), absolutePath);

    expect(isEntrypoint(relativePath, pathToFileURL(absolutePath).href)).toBe(true);
  });
});
