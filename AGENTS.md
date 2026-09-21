# AGENTS.md

setup-vp installs [Vite+](https://viteplus.dev) (`vp`) through GitHub Actions, GitLab CI/CD, and Azure Pipelines.

## Context by Task

- For development setup, commands, and releases, follow [CONTRIBUTING.md](CONTRIBUTING.md).
- For GitHub Actions behavior, start with `action.yml` and `src/index.ts`; input parsing and schemas live in `src/inputs.ts` and `src/types.ts`.
- For GitLab or Azure behavior, start with `src/gitlab/index.ts` or `src/azure/index.ts` and the corresponding templates and bootstrap scripts in `gitlab/` or `azure/`. See [Integration Design](CONTRIBUTING.md#integration-design) for the design references.
- For behavior shared across integrations, start with `src/ci/` and the corresponding adapters under `src/`, `src/gitlab/`, and `src/azure/`.

## Implementation Constraints

- Prefer shared logic under `src/ci/` for behavior used by multiple integrations. Keep `@actions/*` dependencies out of the portable runtimes.
- Keep input parsing, templates, bootstrap scripts, and README examples aligned when changing an interface. GitLab Unix and Windows templates must expose matching inputs.
- Preserve the standalone build entries in `vite.config.ts`. GitLab and Azure download one bundle each; they cannot depend on sibling chunks or the repository's `node_modules`.
- Preserve function and class names in the bundle minification settings. Cache dependencies compare error names with class names.
- Target native `vp.exe` for Windows execution. Do not add legacy `vp.cmd` compatibility.
- When changing lock-file detection, keep `src/utils.ts` and `src/ci/cache.ts` consistent: `pnpm-lock.yaml`, `bun.lockb`, `bun.lock`, `package-lock.json`, `npm-shrinkwrap.json`, and `yarn.lock`. `bun.lockb` identifies a Bun cache; version extraction requires the text `bun.lock`.

## Testing

- Add regression tests beside the affected source files (`src/**/*.test.ts`). For shared behavior changes, check all three integrations, including template and bootstrap tests when interfaces change.
- Build before running tests that inspect or execute `dist/`, including `src/bundle.test.ts`, `src/portable-bundles.test.ts`, and `test/cache-snapshot.test.mjs`.
- Use [.github/workflows/test.yml](.github/workflows/test.yml) for native Windows command/cache regressions and Azure runtime smoke tests. A skipped Windows-only test does not verify Windows behavior; Azure smoke tests on GitHub runners do not verify native Azure Pipelines orchestration.
- Follow the [GitLab E2E procedures](CONTRIBUTING.md#gitlab-end-to-end-tests) for the external suite.

## Commits

- Do not commit without an explicit request. A request to push authorizes staging, committing, and pushing the current task changes; exclude unrelated changes.
- Before committing, run the [required checks](CONTRIBUTING.md#before-committing). Regenerate and commit affected `dist/` bundles with their source changes; do not edit bundles by hand.

## Documentation

- Keep `README.md` focused on user-facing setup, configuration, examples, and behavior. Its Contributing section must link to `CONTRIBUTING.md`.
- Put development commands, contribution requirements, E2E procedures, dependency maintenance, and release instructions in `CONTRIBUTING.md`. Keep detailed designs and integration proposals in `rfcs/`, linked from that guide.
- Keep `AGENTS.md` focused on agent rules, navigation, and implementation constraints. Link to contributor procedures instead of repeating them in `AGENTS.md` or `README.md`.
