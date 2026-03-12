import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  pack: {
    entry: ["./src/index.ts"],
    format: ["esm"],
    outDir: "dist",
    noExternal: [/.*/],
    inlineOnly: false,
    clean: true,
    minify: true,
  },
  lint: {
    ignorePatterns: ["dist/**/*"],
  },
  fmt: {
    ignorePatterns: ["dist/**/*"],
  },
});
