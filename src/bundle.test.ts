import { describe, it, expect } from "vite-plus/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The shipped action is the bundled dist/index.mjs. Several bundled deps
// (notably @actions/cache) branch on `error.name === SomeError.name` — e.g.
// ReserveCacheError, which decides whether a benign cache reserve race is
// logged via core.info or core.warning. If the bundler mangles the class
// binding, `SomeError.name` becomes a mangled identifier and never equals the
// instance's preserved `this.name` literal, so benign errors are wrongly
// surfaced as warning annotations in CI.
//
// pack.minify in vite.config.ts is configured with mangle.keepNames so these
// classes stay named. This test guards against a regression to plain
// `minify: true`, which would emit anonymous `class extends Error` bindings.
const distPath = fileURLToPath(new URL("../dist/index.mjs", import.meta.url));
const dist = readFileSync(distPath, "utf8");

describe("bundled dist preserves @actions/cache error class names", () => {
  for (const className of ["ReserveCacheError", "ValidationError", "FinalizeCacheError"]) {
    it(`keeps the ${className} class name so error.name comparisons work`, () => {
      // A named class declaration or named class expression keeps Class.name.
      // Minification without keepNames would drop the name to a mangled binding.
      const namedClass = new RegExp(`class ${className} extends Error`);
      expect(dist).toMatch(namedClass);
    });
  }
});
