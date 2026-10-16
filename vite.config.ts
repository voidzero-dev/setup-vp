import { defineConfig } from "vite-plus";

const minifyOptions = {
  compress: true,
  // Keep class/function names during minification. Bundled deps such as
  // @actions/cache branch on `error.name === SomeError.name` (e.g.
  // ReserveCacheError). Plain `minify: true` mangles the class binding, so
  // `SomeError.name` becomes the mangled identifier and never matches the
  // instance's preserved `this.name` literal — routing benign errors (like a
  // cache reserve race in a build matrix) to core.warning instead of core.info.
  mangle: { keepNames: { function: true, class: true } },
};

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // PowerShell and Git Bash subprocesses can exceed five seconds on Windows
    // CI runners. Allow startup overhead beyond the subprocess timeout.
    testTimeout: process.platform === "win32" ? 15_000 : 5_000,
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
      minify: minifyOptions,
    },
    {
      entry: { "gitlab/index": "./src/gitlab/index.ts" },
      format: ["esm"],
      outDir: "dist",
      deps: { alwaysBundle: [/.*/], onlyBundle: false },
      clean: false,
      minify: minifyOptions,
    },
    {
      entry: { "azure/index": "./src/azure/index.ts" },
      format: ["esm"],
      outDir: "dist",
      deps: { alwaysBundle: [/.*/], onlyBundle: false },
      clean: false,
      minify: minifyOptions,
    },
  ],
  lint: {
    jsPlugins: ["@e18e/eslint-plugin"],
    ignorePatterns: ["dist/**/*"],
    options: {
      typeAware: true,
      typeCheck: true,
    },
    rules: {
      // Enable rules that work without TypeScript ESLint's type services.
      "e18e/prefer-array-at": "error",
      "e18e/prefer-array-fill": "error",
      "e18e/prefer-includes": "error",
      "e18e/prefer-array-to-reversed": "error",
      "e18e/prefer-array-to-sorted": "error",
      "e18e/prefer-array-to-spliced": "error",
      "e18e/prefer-nullish-coalescing": "error",
      "e18e/prefer-object-has-own": "error",
      "e18e/prefer-url-canparse": "error",
      "e18e/prefer-array-from-map": "error",
      "e18e/prefer-timer-args": "error",
      "e18e/prefer-date-now": "error",
      "e18e/prefer-regex-test": "error",
      "e18e/prefer-array-some": "error",
      "e18e/prefer-static-regex": "error",
      "e18e/prefer-string-fromcharcode": "error",
    },
    overrides: [
      {
        files: ["**/*.test.ts", "test/**"],
        rules: {
          "e18e/prefer-static-regex": "off",
        },
      },
    ],
  },
  fmt: {
    ignorePatterns: ["dist/**/*"],
  },
});
