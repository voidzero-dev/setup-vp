# AGENTS.md

This file provides guidance to coding agents working in this repository.

## Guidelines

- Follow [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, tests, and release procedures.
- Do not commit without an explicit request. A request to push authorizes staging, committing, and pushing the current task changes; exclude unrelated changes.
- Run `vp run check:fix` and `vp run build` before committing. Commit generated changes to `dist/index.mjs`, `dist/gitlab/index.mjs`, and `dist/azure/index.mjs` with their source changes. Do not edit the bundles by hand.

## Documentation

- Keep [README.md](README.md) focused on user-facing setup, configuration, examples, and behavior.
- Put development commands, contribution requirements, E2E procedures, dependency maintenance, and release instructions in [CONTRIBUTING.md](CONTRIBUTING.md).
- Keep detailed design decisions and integration proposals in [`rfcs/`](rfcs/). Link to them from the contributor guide.
- Keep `AGENTS.md` focused on agent rules, code navigation, and implementation constraints. Link to contributor procedures instead of repeating them.

Keep the README's Contributing section as a link to the contributor guide. Do not duplicate contributor procedures in the README.

## Project Overview

setup-vp provides a GitHub Action, GitLab CI/CD remote templates, and an Azure Pipelines step template to install [Vite+](https://viteplus.dev) (`vp`). The integrations support version resolution, Node.js and package-manager management, registry auth, dependency caching, and `vp install` with optional Socket Firewall Free (`sfw`) wrapping.

## Architecture

| Integration     | Entry point           | Bundle                  | Phases                                               |
| --------------- | --------------------- | ----------------------- | ---------------------------------------------------- |
| GitHub Actions  | `src/index.ts`        | `dist/index.mjs`        | `runMain` / `runPost`, selected through action state |
| GitLab CI/CD    | `src/gitlab/index.ts` | `dist/gitlab/index.mjs` | `setup` / `save-cache`                               |
| Azure Pipelines | `src/azure/index.ts`  | `dist/azure/index.mjs`  | `prepare` / `finalize`                               |

- GitHub: `runMain` handles setup and installation. `runPost` saves dependency caches through `@actions/cache` when both `cache` and `cache-save` are enabled.
- GitLab: `setup` installs and configures `vp`, runs dependency installation, and writes shell exports and public dotenv outputs. `.setup-vp-cached` uses native GitLab caching around project-local snapshots; `save-cache` updates the snapshot in `after_script` without restoring stale data first.
- Azure: `prepare` installs `vp`, configures Node.js and package-manager modes, and exports cache metadata. Native `Cache@2` tasks run before `finalize`, which configures auth, runs installation, and publishes outputs. The finalize tasks use the saved bootstrap Node executable.

### Public Interfaces

Keep input parsing, templates, bootstrap scripts, and README examples aligned when changing an interface.

- GitHub: `action.yml`, `src/inputs.ts`, and `src/types.ts`. The Zod schemas validate `run-install`; shared parsers validate Node.js and package-manager modes.
- GitLab: `gitlab/setup-vp.yml`, `gitlab/setup-vp-windows.yml`, and `gitlab/bootstrap.sh` / `gitlab/bootstrap.ps1`. The runtime reads `SETUP_VP_*` variables; Unix and Windows templates must expose matching inputs.
- Azure: `azure/setup-vp.yml`, `azure/bootstrap.sh` / `azure/bootstrap.ps1`, and `src/azure/inputs.ts`.

### Key Modules

- `src/ci/version-file.ts`, `src/ci/lockfile-version.ts`, and `src/ci/node-version-file.ts` - Shared version resolvers. The matching files under `src/` adapt them to GitHub logging and workspace context.
- `src/ci/node-manager.ts` / `src/ci/package-manager.ts` - Shared input parsing and version-dependent environment-mode commands.
- `src/ci/install-viteplus.ts`, `src/ci/install-script-urls.ts`, and `src/ci/vp-dirs.ts` - Portable installer, script selection, and installed-directory detection. `src/install-viteplus.ts` is the GitHub installer adapter.
- `src/ci/auth.ts` / `src/ci/npmrc.ts` - Portable authentication and shared `.npmrc` analysis. `src/auth.ts` handles GitHub environment exports.
- `src/ci/run-install.ts` / `src/ci/install-sfw.ts` - Portable dependency installation and SFW setup. `src/run-install.ts` / `src/install-sfw.ts` provide GitHub-specific execution and caching.
- `src/ci/cache.ts` / `src/ci/cache-snapshot.ts` - Portable cache metadata and GitLab snapshots. `src/cache-restore.ts` / `src/cache-save.ts` use the GitHub cache service; `src/utils.ts` contains GitHub cache-path and lock-file helpers.
- `src/ci/process.ts`, `src/gitlab/shell.ts`, and `src/azure/commands.ts` - Native process execution and platform-specific environment/output exports.

### Implementation Constraints

- Prefer shared logic under `src/ci/` for behavior used by multiple integrations. Keep `@actions/*` dependencies out of the portable runtimes.
- Preserve the standalone build entries in `vite.config.ts`. GitLab and Azure download one bundle each; they cannot depend on sibling chunks or the repository's `node_modules`.
- Preserve function and class names in the bundle minification settings. Cache dependencies compare error names with class names.
- Target native `vp.exe` for Windows execution. Do not add legacy `vp.cmd` compatibility.

### Lock File Detection

Keep cache lock-file detection consistent in `src/utils.ts` and `src/ci/cache.ts`: `pnpm-lock.yaml`, `bun.lockb`, `bun.lock`, `package-lock.json`, `npm-shrinkwrap.json`, and `yarn.lock`.

Distinguish cache detection from version extraction: `bun.lockb` can identify a Bun cache, but the version resolver needs the text `bun.lock` to read a pinned Vite+ version.

## Testing

Add regression tests beside the affected source files (`src/**/*.test.ts`). For shared behavior changes, check the GitHub, GitLab, and Azure adapters, including template and bootstrap tests when their interfaces change. Follow the [pre-commit checks](CONTRIBUTING.md#before-committing).

Build before running tests that inspect or execute `dist/`, including `src/bundle.test.ts`, `src/portable-bundles.test.ts`, and `test/cache-snapshot.test.mjs`.

Use [.github/workflows/test.yml](.github/workflows/test.yml) to locate native Windows command/cache regressions and Azure runtime smoke tests. A skipped Windows-only test does not verify Windows behavior; Azure runtime smoke tests on GitHub runners do not verify native Azure Pipelines orchestration. See [GitLab E2E procedures](CONTRIBUTING.md#gitlab-end-to-end-tests) for the external test suite.
