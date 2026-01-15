# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Guidelines

- Do not commit changes automatically. Wait for explicit user request to commit.

## Project Overview

GitHub Action to set up [Vite+](https://github.com/voidzero-dev/vite-plus) (`vite-plus-cli`) with dependency caching support. This action installs Vite+ globally and optionally caches project dependencies based on lock file detection.

## Commands

```bash
# Build (required before committing - outputs to dist/)
vite run build

# Type check
vite run typecheck

# Run tests
vite run test

# Run tests in watch mode
vite run test:watch

# Lint
vite run lint
vite run lint:fix

# Format
vite run fmt
vite run fmt:check
```

**Important:** Always run `vite run build` after code changes - the `dist/index.mjs` must be committed.

## Architecture

This is a GitHub Action with main and post execution phases (defined in `action.yml`):

- **Main phase** (`src/index.ts` → `runMain`):
  1. Install `vite-plus-cli` globally via npm
  2. Restore dependency cache if enabled
  3. Run `vite install` if requested

- **Post phase** (`src/index.ts` → `runPost`):
  1. Save dependency cache if enabled

### Key Modules

- `src/inputs.ts` - Parse and validate action inputs using Zod schemas
- `src/install-viteplus.ts` - Install vite-plus globally via npm
- `src/cache-restore.ts` / `src/cache-save.ts` - Dependency caching via `@actions/cache`
- `src/run-install.ts` - Execute `vite install` with optional cwd/args
- `src/types.ts` - Shared types, enums, and Zod schemas
- `src/utils.ts` - Lock file detection, package manager cache path resolution

### Lock File Detection

Auto-detects package manager from lock files: `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`

## Testing

Tests are colocated with source files (e.g., `src/inputs.test.ts`). Run with `npm run test`.
