# AGENTS.md

This file provides guidance to coding agents working in this repository.

## Guidelines

- Do not commit changes automatically. Wait for an explicit user request to commit.
- Keep `dist/index.mjs` in sync with source changes by running `vp run build` before committing.

## Project Overview

GitHub Action to set up [Vite+](https://viteplus.dev) (`vp`) with dependency caching support. The action installs Vite+ globally, can set up Node.js via `vp env use`, optionally configures registry auth, restores/saves dependency cache, and can run `vp install` with optional Socket Firewall Free (`sfw`) wrapping.

## Commands

```bash
# Build (required before committing - outputs to dist/)
vp run build

# Type check
vp run typecheck

# Run tests
vp run test

# Run tests in watch mode
vp run test:watch

# Check (lint + format)
vp run check
vp run check:fix
```

**Important:** Always run `vp run check:fix` and `vp run build` before committing. The compiled `dist/index.mjs` must be committed when source changes affect the action bundle.

## Architecture

The action has main and post execution phases. Both are served by `src/index.ts` / `dist/index.mjs`; the phase is selected from GitHub Actions runtime state.

- **Main phase** (`runMain`):
  1. Parse and validate inputs.
  2. Install Vite+ globally via official bash/PowerShell install scripts.
  3. Set up Node.js with `vp env use` when requested.
  4. Configure registry auth from `registry-url`, or propagate auth from the project `.npmrc`.
  5. Restore dependency cache when enabled.
  6. Run `vp install` when requested, optionally wrapped with `sfw`.

- **Post phase** (`runPost`):
  1. Save dependency cache when enabled.

### Key Modules

- `src/index.ts` - Main/post orchestration and action state handling.
- `src/inputs.ts` - Parse and validate action inputs using Zod schemas.
- `src/types.ts` - Shared types, enums, and Zod schemas.
- `src/install-viteplus.ts` - Install Vite+ globally via official install scripts.
- `src/node-version-file.ts` - Resolve Node.js versions from supported version files.
- `src/auth.ts` - Configure npm registry authentication from action inputs and repo `.npmrc`.
- `src/cache-restore.ts` / `src/cache-save.ts` - Dependency caching via `@actions/cache`.
- `src/run-install.ts` - Execute `vp install` entries with optional cwd/args.
- `src/install-sfw.ts` - Install or reuse Socket Firewall Free for wrapped installs.
- `src/utils.ts` - Lock file detection, package-manager cache paths, and shared helpers.

### Lock File Detection

Auto-detects package manager from lock files: `pnpm-lock.yaml`, `bun.lockb`, `bun.lock`, `package-lock.json`, `npm-shrinkwrap.json`, `yarn.lock`.

## Testing

Tests are colocated with source files (for example, `src/inputs.test.ts`). Run `vp run test` for test coverage, then run `vp run check:fix` and `vp run build` before committing.
