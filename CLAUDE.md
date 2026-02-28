# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Guidelines

- Do not commit changes automatically. Wait for explicit user request to commit.

## Project Overview

GitHub Action to set up [Vite+](https://github.com/voidzero-dev/vite-plus) (`vp`) with dependency caching support. This action installs Vite+ globally via official install scripts and optionally caches project dependencies based on lock file detection.

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

**Important:** Always run `vp run check:fix` and `vp run build` before committing - the `dist/index.mjs` must be committed.

## Architecture

This is a GitHub Action with main and post execution phases (defined in `action.yml`):

- **Main phase** (`src/index.ts` → `runMain`):
  1. Install Vite+ globally via bash/PowerShell install scripts
  2. Set up Node.js version via `vp env use` if specified
  3. Restore dependency cache if enabled
  4. Run `vp install` if requested

- **Post phase** (`src/index.ts` → `runPost`):
  1. Save dependency cache if enabled

### Key Modules

- `src/inputs.ts` - Parse and validate action inputs using Zod schemas
- `src/install-viteplus.ts` - Install Vite+ globally via official install scripts
- `src/cache-restore.ts` / `src/cache-save.ts` - Dependency caching via `@actions/cache`
- `src/run-install.ts` - Execute `vp install` with optional cwd/args
- `src/types.ts` - Shared types, enums, and Zod schemas
- `src/utils.ts` - Lock file detection, package manager cache path resolution

### Lock File Detection

Auto-detects package manager from lock files: `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`

## Testing

Tests are colocated with source files (e.g., `src/inputs.test.ts`). Run with `vp run test`.
