import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
  staged: {
    "*": "vp check --fix",
  },
  // Build each entry independently so the portable CI runtimes remain
  // standalone files. A shared chunk would not be present when GitLab or
  // Azure downloads only its entrypoint from raw.githubusercontent.com.
  pack: [
    {
      entry: { index: "./src/index.ts" },
      format: ["esm"],
      outDir: "dist",
      deps: { alwaysBundle: [/.*/], onlyBundle: false },
      clean: true,
      minify: {
        compress: true,
        mangle: { keepNames: { function: true, class: true } },
      },
    },
    {
      entry: { "gitlab/index": "./src/gitlab/index.ts" },
      format: ["esm"],
      outDir: "dist",
      deps: { alwaysBundle: [/.*/], onlyBundle: false },
      clean: false,
      minify: {
        compress: true,
        mangle: { keepNames: { function: true, class: true } },
      },
    },
    {
      entry: { "azure/index": "./src/azure/index.ts" },
      format: ["esm"],
      outDir: "dist",
      deps: { alwaysBundle: [/.*/], onlyBundle: false },
      clean: false,
      minify: {
        compress: true,
        mangle: { keepNames: { function: true, class: true } },
      },
    },
  ],
  // Keep class/function names during minification. Bundled deps such as
  // @actions/cache branch on `error.name === SomeError.name` (e.g.
  // ReserveCacheError). Plain `minify: true` mangles the class binding, so
  // `SomeError.name` becomes the mangled identifier and never matches the
  // instance's preserved `this.name` literal — routing benign errors (like a
  // cache reserve race in a build matrix) to core.warning instead of core.info.
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
