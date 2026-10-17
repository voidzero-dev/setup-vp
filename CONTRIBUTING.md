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

### Pull Request Analysis

The [Fallow workflow](.github/workflows/fallow.yml) runs `fallow audit` on pull requests. It checks changed files for unused code, complexity, duplication, and styling issues. Only new findings can fail the check; existing findings do not block adoption.

The action uses the exact `fallow` version in `package.json`. After `vp install`, run the same analysis locally:

```bash
vp exec fallow audit --base origin/main
```

[`.fallowrc.json`](.fallowrc.json) declares the three runtime entry points. Fallow excludes generated files under `dist/` by default. Results appear in annotations, CI logs, and the job summary. The workflow does not write PR comments.

## Integration Design

Use the shared primitives under [`src/ci/`](src/ci/) for portable runtime behavior.

- GitLab: edit the TypeScript runtime under [`src/gitlab/`](src/gitlab/). The template downloads and runs the `vp pack` bundle at `dist/gitlab/index.mjs`. See the [GitLab integration notes](rfcs/gitlab-integration.md) for design constraints and follow-up work.
- Azure Pipelines: edit the runtime under [`src/azure/`](src/azure/). Azure cannot execute the GitHub Action bundle; the template runs `dist/azure/index.mjs` in `prepare` and `finalize` phases around `Cache@2`. See the [Azure integration notes](rfcs/azure-pipelines-integration.md) for the design, parity table, and cache semantics.

### Installer Node Selection

All three integrations run the installer from the configured project directory. setup-vp selects the Node version: `node-version` takes precedence over `node-version-file`, followed by automatic project discovery. Discovery checks `.node-version`, `package.json#devEngines.runtime`, `package.json#engines.node`, and `.nvmrc` in each directory before checking its parent. It passes the selected value through `VP_SETUP_NODE_VERSION`. With no selection or with `node-manager: false`, it clears the override so the installer keeps its LTS default.

Installers that support this protocol resolve an explicit environment override once and reuse that Node version when it satisfies both the CLI and the pinned pnpm requirements. Otherwise, they use a separate LTS runtime for installation. The installer itself does not discover project pins or apply normal Node session or user defaults. For an override, it writes the exact requested version to the temporary path in `VP_SETUP_NODE_VERSION_FILE`; this remains the requested version even when installation needs a fallback. For an explicit input, setup-vp uses that result for `vp env use`. Automatic discovery retains its normal directory scope.

The temporary result is cleared before each installer attempt and removed after installation. Older installers do not write a result, so setup-vp retains the original selector and existing behavior. Updating setup-vp alone does not enable runtime reuse for an older Vite+ release.

## GitLab End-to-End Tests

Use the dedicated [GitLab test project](https://gitlab.com/fengmk2/setup-vp-gitlab-test) to test the remote integration. The [GitLab E2E workflow](.github/workflows/gitlab-e2e.yml) accepts `run-e2e` label requests for same-repository PRs and manual `workflow_dispatch` requests on `main`. The job uses the GitLab trigger secret without checking out or executing PR files on the GitHub runner.

### Request a Run

For a same-repository PR, review its current head commit, including workflow changes, then add `run-e2e`:

```bash
gh pr edit 123 --add-label run-e2e
```

The workflow checks that the labeler has repository write access and runs the full suite at the label event's head SHA. After each new commit, review the changes, then remove and re-add `run-e2e`. Keeping the label on a PR does not approve later pushes. The handler rejects stale heads, closed PRs, and requests whose label was removed.

### Manual Runs and Fork PRs

Fork PRs use manual dispatch because `pull_request` workflows do not receive the GitLab secret from the base repository. For a manual PR run, set the PR number and record its current head SHA. Review that commit before starting the workflow:

```bash
pr_number=123
reviewed_sha="$(gh pr view "$pr_number" --json headRefOid --jq .headRefOid)"
```

After review, start the full suite from the trusted workflow on `main`:

```bash
gh workflow run gitlab-e2e.yml --ref main \
  -f pull_request="$pr_number" \
  -f setup_ref="$reviewed_sha" \
  -f suite=full
```

Manual dispatch works for same-repository and fork PRs. The workflow rejects a request if the PR head changes before validation. Each new commit needs another review and request. For both label and manual requests, check the workflow's logs and job summary for the tested commit, suite, pipeline link, and result. The workflow does not write PR comments.

For a standalone run, omit `pull_request`. Set `setup_ref` to an exact commit SHA or release tag, or leave it empty to test the workflow commit. Select `suite` (`full` by default) and `vite_plus_version` (`latest` by default). Manual runs selected on branches other than `main` skip the job.

Pushes, merge queue commits, merges, and release tags do not automatically start GitLab pipelines. Release PRs must pass the full suite on their current head commit before merging; follow the [release procedure](#releasing).

## Dependency Updates

For same-repository PRs with the `needs-bundle-rebuild` label, [the build workflow](.github/workflows/rebuild-bundle.yml) builds the exact PR commit with read-only access. After a successful build, a maintainer reviews its commit and dispatches [the publisher](.github/workflows/publish-bundle.yml) on `main` with that build's run ID:

```bash
gh workflow run publish-bundle.yml --ref main -f run_id=123456789
```

Replace `123456789` with the completed **Rebuild action bundle** run ID from its Actions URL. Publishing is manual; the label only starts the unprivileged build.

The publisher reads the build record from GitHub and verifies its workflow, repository, and current PR head. It validates the three bundle files before creating a repository-scoped GitHub App token. It never executes PR code or downloaded bundles. It skips stale PR heads and unchanged bundles; the commit fails if the branch head changes after validation.

The PR's `rebuild-bundle.yml` must match the default branch before the publisher accepts the build. After changes to that workflow reach the default branch, update existing dependency branches and rerun the build before dispatching the publisher.

Renovate opens a PR when SocketDev publishes a new `sfw-free` release. The custom manager in [`.github/renovate.json`](.github/renovate.json) updates the shared `SFW_VERSION` pin in `src/ci/install-sfw.ts` for all three integrations.

## Releasing

Publish releases as Git tags, not as an npm package. Keep `package.json.version` aligned with the release tag. Consumers pin an exact tag such as `voidzero-dev/setup-vp@v1.21.2` or a commit SHA. Do not move the `v1` major tag, which is frozen at `v1.15.0`.

1. Open a release PR. Set the upcoming version in `package.json`; use it as the source of truth for the release version. Update the release examples in `README.md` and this guide. Set these defaults to `v` followed by that version:

   - The `setup-ref` inputs and inline bootstrap fallbacks in `gitlab/setup-vp.yml` and `gitlab/setup-vp-windows.yml`.
   - The `setupRef` parameter in `azure/setup-vp.yml`.
   - The `SETUP_VP_SETUP_REF` fallbacks in `gitlab/bootstrap.sh`, `gitlab/bootstrap.ps1`, `azure/bootstrap.sh`, and `azure/bootstrap.ps1`.

   Run the [required checks](#before-committing) and commit the release changes, including any updated bundles. The bootstrap and template tests compare these defaults with `package.json.version`, so an omitted update fails CI. Do not resolve `latest` at runtime or reuse the frozen `v1` tag.

2. Review the release PR's current head commit, then add `run-e2e` for a same-repository PR or dispatch the full suite from `main` for a fork. Follow the [GitLab E2E procedures](#gitlab-end-to-end-tests). After any new commit, including an update from `main`, review the changes and remove and re-add the label or dispatch another run for the new SHA.

3. Merge the release PR only after GitHub CI and the full GitLab suite pass. Check the GitLab E2E job summary: its result must be `success`, its suite must be `full`, and its tested commit must still match the PR head.

   Keep the PR open if verification fails, is cancelled, or has no result for the current head. Fix the failure, including outdated fixtures in the dedicated GitLab test project when needed, then request another run. Wait for a passing result before merging. Do not defer this check until after merging or bypass it with an administrator merge.

4. Update `main` and confirm that `HEAD` is the release PR's merge commit. Confirm that all three bundles in `dist/` are in sync. The working tree must stay clean after building:

   ```bash
   git checkout main
   git pull --ff-only
   vp run build
   git status --short   # must be empty
   ```

5. Create the new annotated version tag on the release PR's merge commit and push it. For example:

   ```bash
   git tag -a v1.21.2 -m "v1.21.2"
   git push origin v1.21.2
   ```
