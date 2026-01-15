import { defineConfig } from "vite-plus";

export default defineConfig({
  lib: {
    entry: ["./src/index.ts"],
    format: ["esm"],
    outDir: "dist",
    noExternal: [/.*/],
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
