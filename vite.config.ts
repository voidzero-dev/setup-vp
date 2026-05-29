import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
  staged: {
    "*": "vp check --fix",
  },
  pack: {
    entry: ["./src/index.ts"],
    format: ["esm"],
    outDir: "dist",
    deps: {
      alwaysBundle: [/.*/],
      onlyBundle: false,
    },
    clean: true,
    // Keep class/function names during minification. Bundled deps such as
    // @actions/cache branch on `error.name === SomeError.name` (e.g.
    // ReserveCacheError). Plain `minify: true` mangles the class binding, so
    // `SomeError.name` becomes the mangled identifier and never matches the
    // instance's preserved `this.name` literal — routing benign errors (like a
    // cache reserve race in a build matrix) to core.warning instead of core.info.
    minify: {
      compress: true,
      mangle: { keepNames: { function: true, class: true } },
    },
  },
  lint: {
    ignorePatterns: ["dist/**/*"],
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {
    ignorePatterns: ["dist/**/*"],
  },
});
