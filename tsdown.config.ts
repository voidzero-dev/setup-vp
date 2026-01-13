import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['./src/index.ts'],
  format: ['esm'],
  outDir: 'dist',
  noExternal: [/.*/],
  clean: true,
  minify: true,
})
