# Contributing

For setup-vp usage and configuration, see the [README](README.md).

## Development

### Install Vite+ CLI

- Linux / macOS: `curl -fsSL https://viteplus.dev/install.sh | bash`
- Windows: `irm https://viteplus.dev/install.ps1 | iex`

### Setup

```bash
git clone https://github.com/voidzero-dev/setup-vp.git
cd setup-vp
vp install
```

### Available Commands

| Command             | Description                  |
| ------------------- | ---------------------------- |
| `vp run build`      | Build the bundles in `dist/` |
| `vp run test`       | Run tests                    |
| `vp run test:watch` | Run tests in watch mode      |
| `vp run typecheck`  | Check types                  |
| `vp run check`      | Check lint and formatting    |
| `vp run check:fix`  | Fix lint and formatting      |

### Before Committing

Format and build before running the tests, because some tests inspect or execute the bundles in `dist/`:

```bash
vp run check:fix
vp run build
vp run typecheck
vp run test
```

Commit generated changes under `dist/` with the source changes. Include `dist/index.mjs` for GitHub Actions, `dist/gitlab/index.mjs` for GitLab, and `dist/azure/index.mjs` for Azure Pipelines.

The [pre-commit hook](.vite-hooks/pre-commit) runs `vp staged`. The staged-file configuration in [vite.config.ts](vite.config.ts) runs `vp check --fix` on staged files. Run the build yourself; the hook does not rebuild the bundles.

## Integration Design

Use the shared primitives under [`src/ci/`](src/ci/) for portable runtime behavior.

- GitLab: edit the TypeScript runtime under [`src/gitlab/`](src/gitlab/). The template downloads and runs the `vp pack` bundle at `dist/gitlab/index.mjs`. See the [GitLab integration notes](rfcs/gitlab-integration.md) for design constraints and follow-up work.
- Azure Pipelines: edit the runtime under [`src/azure/`](src/azure/). Azure cannot execute the GitHub Action bundle; the template runs `dist/azure/index.mjs` in `prepare` and `finalize` phases around `Cache@2`. See the [Azure integration notes](rfcs/azure-pipelines-integration.md) for the design, parity table, and cache semantics.

## GitLab End-to-End Tests

Use the dedicated [GitLab test project](https://gitlab.com/fengmk2/setup-vp-gitlab-test) to test the remote integration. GitLab CI has limited capacity, so the [GitLab E2E workflow](.github/workflows/gitlab-e2e.yml) runs only for pull requests approved with the `run-e2e` label or manual `workflow_dispatch` requests. The pipeline loads the template, bootstrap script, and compiled runtime from the exact approved PR commit or the manually selected commit or release tag.

### Request a Run

After reviewing the commit, a maintainer with write access can add `run-e2e` to run the full GitLab suite. This applies to both same-repository and fork PRs. Approve the Actions run if prompted.

For each new commit, review the changes and remove and re-add `run-e2e`. Read the PR result comment for the status and GitLab pipeline link after each run.

Pushes, merge queue commits, merges, and release tags do not automatically start GitLab pipelines.

For a manual run, use `workflow_dispatch`. Set `setup_ref` to an exact commit SHA or release tag, or leave it empty to test the selected workflow commit. Select `suite` (`full` by default) and `vite_plus_version` (`latest` by default).

## Dependency Updates

Renovate opens a PR when SocketDev publishes a new `sfw-free` release. See the custom managers in [`.github/renovate.json`](.github/renovate.json) for the pinned `SFW_VERSION` values in the GitHub and portable runtimes.

## Releasing

Publish releases as Git tags, not as an npm package. Keep `package.json.version` aligned with the release tag. Consumers pin an exact tag such as `voidzero-dev/setup-vp@v1.20.0` or a commit SHA. Do not move the `v1` major tag, which is frozen at `v1.15.0`.

1. Open a release PR. Set the upcoming version in `package.json`; use it as the source of truth for the release version. Update the release examples in `README.md` and this guide. Set these defaults to `v` followed by that version:

   - The `setup-ref` inputs and inline bootstrap fallbacks in `gitlab/setup-vp.yml` and `gitlab/setup-vp-windows.yml`.
   - The `setupRef` parameter in `azure/setup-vp.yml`.
   - The `SETUP_VP_SETUP_REF` fallbacks in `gitlab/bootstrap.sh`, `gitlab/bootstrap.ps1`, `azure/bootstrap.sh`, and `azure/bootstrap.ps1`.

   Run `vp run test` before merging the release PR. The bootstrap and template tests compare these defaults with `package.json.version`, so an omitted update fails CI. Merge all version changes before creating the tag; do not resolve `latest` at runtime or reuse the frozen `v1` tag.

2. Update `main` and confirm that all three bundles in `dist/` are in sync. The working tree must stay clean after building:

   ```bash
   git checkout main
   git pull --ff-only
   vp run build
   git status --short   # must be empty
   ```

3. Confirm that the release commit on `main` passes the full GitLab E2E workflow. Use `workflow_dispatch` with the exact commit SHA and `suite: full`.

4. Create the new annotated version tag and push it. For example:

   ```bash
   git tag -a v1.20.0 -m "v1.20.0"
   git push origin v1.20.0
   ```
