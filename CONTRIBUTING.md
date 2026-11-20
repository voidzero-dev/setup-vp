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

[`.fallowrc.json`](.fallowrc.json) declares the three runtime entry points and the [Cloudflare CI](#cloudflare-ci) pipeline entry point. Fallow skips hidden directories by default, so the configuration includes `.cloudflare/` explicitly. Fallow excludes generated files under `dist/` by default. Results appear in annotations, CI logs, and the job summary. The workflow does not write PR comments.

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

## Cloudflare CI

[`.cloudflare/ci/`](.cloudflare/ci/) contains a Cloudflare CI pipeline. Cloudflare CI is in preview. The pipeline runs two jobs from [`test.yml`](.github/workflows/test.yml) in Cloudflare runners and reports them as GitHub checks:

- `cloudflare-ci/build`: `typecheck`, `check`, `build`, and a check that `dist/` is up to date.
- `cloudflare-ci/unit-tests`: `build`, then `test`.

The other jobs in `test.yml` run the action through `uses: ./`, so they stay on GitHub Actions. The Cloudflare CI checks are not required checks.

The pipeline is a Workflow in the `setup-vp-ci` Worker of the `VoidZero-docs` Cloudflare account. The deployed version runs for every branch. A change under `.cloudflare/ci/` takes effect only after a deploy, so a PR that changes the pipeline still runs the deployed version.

To use Wrangler, you need access to the `VoidZero-docs` account. Run `npx wrangler@4.163.0 login` first.

### Start a Run

GitHub triggers are not available yet, so start each run with Wrangler:

```bash
cd .cloudflare/ci

# A pull request: posts the checks, and a PR comment if a check fails.
npx wrangler@4.163.0 workflows trigger setup-vp-ci '{"mr":123}'

# A commit (full SHA): posts or updates the checks, with no comment.
npx wrangler@4.163.0 workflows trigger setup-vp-ci "{\"sha\":\"$(git rev-parse HEAD)\"}"

# Follow runs.
npx wrangler@4.163.0 workflows instances list setup-vp-ci
npx wrangler@4.163.0 workflows instances describe setup-vp-ci <INSTANCE_ID>
```

An `mr` run posts a PR comment only when a check fails. Cloudflare CI cannot update a comment yet, so each failed run posts a new one. A second run on the same commit updates the same checks.

### Read Logs

- Each check summary shows the runner log, up to its last 16 KiB. The runner keeps no more than that.
- In the PR comment, each check name links to its check page on the PR, which shows the log.
- The **Details** link of each check and the last link in the PR comment open the run in the Cloudflare dashboard. Only members of the `VoidZero-docs` account can open it.
- `describe` and `describe --json` cut each step output to about 1 KiB. Use them for the step status and the run error, not for logs.
- Each job runs in `timeout 14m`. A job that hangs stops with exit code 124 and keeps its log. The 15-minute step timeout would lose the log.
- To run a failed job again without the other steps before it, restart the run from that job's step. The restart also runs every later step, which includes the PR comment of an `mr` run:

  ```bash
  npx wrangler@4.163.0 workflows instances restart setup-vp-ci <INSTANCE_ID> --from-step-name "unit-tests"
  ```

### Change the Pipeline

1. Edit the files in `.cloudflare/ci/src/`, and increase `PIPELINE_VERSION` in `index.ts`.
2. Run `vp check`. It formats, lints, and type-checks the pipeline with [`.cloudflare/ci/tsconfig.json`](.cloudflare/ci/tsconfig.json) and `@cloudflare/workers-types`.
3. After the change merges, deploy from `main`:

   ```bash
   cd .cloudflare/ci
   npx wrangler@4.163.0 deploy
   ```

4. Read `output.version` in the result of the next run. A run that starts in the first minutes after a deploy can still use the previous version. The plain `describe` output does not include the return value, so use `--json`:

   ```bash
   npx wrangler@4.163.0 workflows instances describe setup-vp-ci <INSTANCE_ID> --json --step-output=false
   ```

### Runner Environment

- Every runner uses the managed `workflows/node` image. It has Node.js 24, Corepack (pnpm and yarn), `git`, `jq`, `curl`, and build-essential. GitHub CI uses `lts/*` from `.node-version`.
- The `checkout` step fetches the commit from GitHub with `git fetch --depth 1`. The repository is public, so this needs no token, also for the head of a fork PR. The `build` job compares `dist/` with `git diff --exit-code`, the same as `test.yml`.
- The `install` step gets only `package.json`, `pnpm-lock.yaml`, and `pnpm-workspace.yaml`, and saves `node_modules` for the jobs. It uses the runner cache, so a run skips it while those files do not change. The cache keeps results for 7 days. `output.installCached` in the run result shows whether the install came from the cache.
- The install uses `pnpm install --ignore-scripts`. The root `prepare` script (`vp config`) sets up Git hooks, and the install step has no repository to set them up in. The repository allows no dependency build scripts, so the flag skips nothing else.
- If the checkout or the install fails, both checks fail with the error. These steps retry 2 times, because network errors can cause them.
- `@cloudflare/workers-types` does not include `step.runner()`. [`runner.d.ts`](.cloudflare/ci/src/runner.d.ts) declares it with the result that the runtime returns, `logs: { data, truncated }`. The Cloudflare CI docs show `logs.stdout` and `logs.stderr` instead.

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

Publish releases as Git tags, not as an npm package. Keep `package.json.version` aligned with the release tag. Consumers pin an exact tag such as `voidzero-dev/setup-vp@v1.22.0` or a commit SHA. Do not move the `v1` major tag, which is frozen at `v1.15.0`.

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
   git tag -a v1.22.0 -m "v1.22.0"
   git push origin v1.22.0
   ```
