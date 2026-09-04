# setup-vp

GitHub Action, GitLab CI/CD remote template, and Azure Pipelines step template to set up [Vite+](https://viteplus.dev) (`vp`).

## Features

- Install Vite+ globally via official install scripts
- GitHub Action: optionally set up a specific Node.js version via `vp env use`
- GitHub Action: cache project dependencies with auto-detection of lock files
- Optionally run `vp install` after setup
- Optionally wrap `vp install` with [Socket Firewall Free (`sfw`)](https://docs.socket.dev/docs/socket-firewall-free) to block malicious dependencies
- Support for all major package managers (npm, pnpm, yarn, bun)
- GitLab CI/CD support through a reusable `include:remote` template
- Azure Pipelines support through a reusable step template and compiled runtime

## Versioning

Reference this action with an exact release tag, or a commit SHA:

```yaml
- uses: voidzero-dev/setup-vp@v1.19.0
```

Releases are listed on the [tags page](https://github.com/voidzero-dev/setup-vp/tags). [Renovate](https://docs.renovatebot.com/) and Dependabot can keep a pinned tag up to date.

> [!WARNING]
> The moving major tag `v1` is frozen at `v1.15.0` and no longer updated. Workflows that use `voidzero-dev/setup-vp@v1` keep working but stay on v1.15.0 and will not receive new releases: switch them to an exact version tag. The same applies to the GitLab and Azure templates; use an exact tag in the `include:remote` URL / repository `ref` and in `setup-ref` / `setupRef`.

## Usage

### Basic Usage

```yaml
steps:
  - uses: actions/checkout@v6
  - uses: voidzero-dev/setup-vp@v1.19.0
```

### With Node.js Version

```yaml
steps:
  - uses: actions/checkout@v6
  - uses: voidzero-dev/setup-vp@v1.19.0
    with:
      node-version: "lts"
```

### With Node.js Version File

```yaml
steps:
  - uses: actions/checkout@v6
  - uses: voidzero-dev/setup-vp@v1.19.0
    with:
      node-version-file: ".node-version"
```

### Keep the Runner's Node.js

The Vite+ installer enables its own Node.js version manager on CI. When
Node.js is managed elsewhere (`actions/setup-node`, Flox, mise, or the runner
image), disable it so `vp` and its shims use that Node.js:

```yaml
steps:
  - uses: actions/checkout@v6
  - uses: actions/setup-node@v5
    with:
      node-version: 24
  - uses: voidzero-dev/setup-vp@v1.19.0
    with:
      node-manager: false
```

### With Working Directory

```yaml
steps:
  - uses: actions/checkout@v6
  - uses: voidzero-dev/setup-vp@v1.19.0
    with:
      working-directory: web
      node-version-file: ".nvmrc"
      cache: true
      run-install: true
```

### With Caching and Install

```yaml
steps:
  - uses: actions/checkout@v6
  - uses: voidzero-dev/setup-vp@v1.19.0
    with:
      node-version: "lts"
      cache: true
      run-install: true
```

### Specific Version

```yaml
steps:
  - uses: actions/checkout@v6
  - uses: voidzero-dev/setup-vp@v1.19.0
    with:
      version: "1.2.3"
      node-version: "lts"
      cache: true
```

### Version from `package.json` / Catalog

Keep a single source of truth for the Vite+ version by resolving it from the
checked-out project instead of duplicating it in the workflow.

By default (when neither `version` nor `version-file` is set), the action reads
the `vite-plus` entry from the project's `package.json` and installs that
version. When that entry is a semver range like `^0.2.0` (which can't be
installed directly), it is resolved to the exact version recorded in the
lockfile (`pnpm-lock.yaml`, `package-lock.json`, `npm-shrinkwrap.json`,
`yarn.lock`, or `bun.lock`; the binary `bun.lockb` can't be read). It falls back
to `latest` only when nothing pins a resolvable version. So a project that pins
`vite-plus` needs no extra configuration:

```yaml
steps:
  - uses: actions/checkout@v6
  - uses: voidzero-dev/setup-vp@v1.19.0
    with:
      cache: true
```

To resolve from a specific file, set `version-file` explicitly. Like the
auto-detect default, an explicit `version-file` that can't be resolved logs a
warning and falls back to `latest` (it does not fail the run); the warning is
worth watching for, since it means the pinned version was not applied:

```yaml
steps:
  - uses: actions/checkout@v6
  - uses: voidzero-dev/setup-vp@v1.19.0
    with:
      version-file: package.json
      cache: true
```

When the `package.json` entry is `catalog:` / `catalog:<name>`, it is resolved
through the nearest catalog source (searching upward from the manifest),
covering every package manager that implements the `catalog:` protocol:

```jsonc
// package.json
{
  "devDependencies": {
    "vite-plus": "catalog:",
  },
}
```

- **pnpm**: `pnpm-workspace.yaml`

  ```yaml
  catalog:
    vite-plus: 0.2.0
  ```

- **yarn** (>= 4.10): `.yarnrc.yml`

  ```yaml
  catalog:
    vite-plus: 0.2.0
  ```

- **bun**: root `package.json` (`catalog`/`catalogs`, top-level or under `workspaces`)

  ```jsonc
  {
    "workspaces": {
      "packages": ["packages/*"],
      "catalog": { "vite-plus": "0.2.0" },
    },
  }
  ```

For **npm** (no catalog feature) or any project that pins the version directly,
just declare an exact version (`"vite-plus": "0.2.0"`) and it is used as-is.

You can also point `version-file` straight at `pnpm-workspace.yaml` or
`.yarnrc.yml` to read its default catalog entry. An explicit `version` always
takes precedence over `version-file`. A resolved value must be an exact version
or dist-tag: when an explicit `version-file` yields a semver range (e.g.
`^0.2.0`) or an alias (`npm:` / `git:`), it can't be installed directly, so the
action warns and falls back to `latest`. (Auto-detection instead resolves a
`package.json` range through the lockfile, as described above.)

### Advanced Run Install

```yaml
steps:
  - uses: actions/checkout@v6
  - uses: voidzero-dev/setup-vp@v1.19.0
    with:
      node-version: "lts"
      cache: true
      run-install: |
        - cwd: ./packages/app
          args: ['--frozen-lockfile']
        - cwd: ./packages/lib
```

### With Private Registry (GitHub Packages)

If your repo has a `.npmrc` that declares the registry, pass `NODE_AUTH_TOKEN`
via `env` and let the default `vp install` run — no `registry-url` needed.
When `NODE_AUTH_TOKEN` is set, the action auto-generates a matching
`_authToken` entry at `$RUNNER_TEMP/.npmrc` for each registry declared in your
repo `.npmrc` that doesn't already have one, so your repo `.npmrc` can stay
minimal:

```yaml
# .npmrc in the repo (auth line not required — action adds it):
#   @myorg:registry=https://npm.pkg.github.com

steps:
  - uses: actions/checkout@v6
  - uses: voidzero-dev/setup-vp@v1.19.0
    with:
      node-version: "lts"
    env:
      NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

If you already have the `_authToken` line in your repo `.npmrc` (e.g. for local
dev symmetry), that's respected as-is and the action won't overwrite it.

Alternatively, pass `registry-url` explicitly to bypass the action's repo-level
`.npmrc` detection and auth propagation logic (the package manager may still
read the repo `.npmrc` per its own config resolution):

```yaml
steps:
  - uses: actions/checkout@v6
  - uses: voidzero-dev/setup-vp@v1.19.0
    with:
      node-version: "lts"
      registry-url: "https://npm.pkg.github.com"
      scope: "@myorg"
      run-install: false
  - run: vp install
    env:
      NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

### With Socket Firewall Free (sfw)

Set `sfw: true` to wrap `vp install` with [Socket Firewall Free](https://docs.socket.dev/docs/socket-firewall-free). The action downloads the matching `sfw` binary from the upstream [releases](https://github.com/SocketDev/sfw-free/releases) (auto-detected per OS/arch, with musl support on Alpine) and runs `sfw vp install …` so the underlying npm / pnpm / yarn fetches are inspected before packages are installed. Works on Linux, macOS, and Windows:

```yaml
steps:
  - uses: actions/checkout@v6
  - uses: voidzero-dev/setup-vp@v1.19.0
    with:
      sfw: true
      run-install: true
```

`sfw` is only applied when `run-install` is enabled; other `vp` commands (e.g. `vp env use`, `vp --version`) run unwrapped.

The action pins the `sfw` version it downloads so a re-run of the same commit gets the same binary; [Renovate](https://docs.renovatebot.com/) opens a PR whenever SocketDev publishes a new `sfw-free` release (see [`.github/renovate.json`](.github/renovate.json)).

#### Advanced: stricter supply chain via `socketdev/action`

The bundled download uses a pinned URL but is not itself SHA-pinned. For workflows that want the `sfw` binary itself SHA-pinned (so a compromise of the upstream release artifact cannot land silently on the next run), compose with [`socketdev/action`](https://github.com/SocketDev/action) in an earlier step. setup-vp auto-detects an existing `sfw` on `PATH` and uses it instead of downloading:

```yaml
steps:
  - uses: actions/checkout@v6
  # SHA-pinned; let Renovate bump it
  - uses: socketdev/action@<sha>
    with:
      mode: firewall-free
  - uses: voidzero-dev/setup-vp@v1.19.0
    with:
      sfw: true
      run-install: true
```

In the action log you will see `Using existing sfw on PATH: …` when this composition is detected, vs. `Installing sfw from …` for the bundled-download path.

> [!NOTE]
> **macOS / Windows require Vite+ v0.1.23 or newer.** Earlier `vp` releases didn't honor `HTTPS_PROXY` / `SSL_CERT_FILE`, so `sfw vp install` failed the TLS handshake on macOS / Windows (it always worked on Linux). The action's default `version: latest` satisfies this; if you pin an older `vp` and enable `sfw` on macOS / Windows, the install will fail the handshake. On a runner architecture with no published `sfw` binary (e.g. `riscv64`), the action logs a warning and falls back to plain `vp install`.

### Alpine Container

Alpine Linux uses musl libc instead of glibc. Install compatibility packages before using the action:

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    container:
      image: alpine:3.21
    steps:
      - run: apk add --no-cache bash curl gcompat libstdc++
      - uses: actions/checkout@v6
      - uses: voidzero-dev/setup-vp@v1.19.0
```

### Matrix Testing with Multiple Node.js Versions

```yaml
jobs:
  test:
    strategy:
      matrix:
        node-version: ["20", "22", "24"]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: voidzero-dev/setup-vp@v1.19.0
        with:
          node-version: ${{ matrix.node-version }}
          cache: true
      - run: vp run test
```

## Inputs

| Input                   | Description                                                                                                 | Required | Default          |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- | -------- | ---------------- |
| `version`               | Version of Vite+ to install. Takes precedence over `version-file`                                           | No       | auto / `latest`  |
| `version-file`          | Path to a file to resolve the Vite+ version from (`package.json`, `pnpm-workspace.yaml`, or `.yarnrc.yml`)  | No       |                  |
| `node-version`          | Node.js version to install via `vp env use`                                                                 | No       | Vite+ resolution |
| `node-version-file`     | Path to file containing Node.js version (`.nvmrc`, `.node-version`, `.tool-versions`, `package.json`)       | No       |                  |
| `node-manager`          | Control Vite+'s Node.js manager: `false` keeps the runner's Node.js, `true` force-enables the managed one   | No       | Auto (on for CI) |
| `working-directory`     | Project directory used for relative paths, lockfile auto-detection, environment checks, and default install | No       | Workspace root   |
| `run-install`           | Run `vp install` after setup. Accepts boolean or YAML object with `cwd`/`args`                              | No       | `true`           |
| `sfw`                   | Wrap `vp install` with [Socket Firewall Free](https://docs.socket.dev/docs/socket-firewall-free) (`sfw`)    | No       | `false`          |
| `cache`                 | Enable caching of project dependencies                                                                      | No       | `false`          |
| `cache-save`            | Save the dependency cache in the post action. Has no effect when `cache` is `false`                         | No       | `true`           |
| `cache-dependency-path` | Path to lock file for cache key generation                                                                  | No       | Auto-detected    |
| `registry-url`          | Optional registry to set up for auth. Sets the registry in `.npmrc` and reads auth from `NODE_AUTH_TOKEN`   | No       |                  |
| `scope`                 | Optional scope for scoped registries. Falls back to repo owner for GitHub Packages                          | No       |                  |

When `working-directory` is set, relative `run-install.cwd`, `node-version-file`, `version-file`, and `cache-dependency-path` values are resolved from that directory.

Omitting both `node-version` and `node-version-file` leaves the session without an override. With the Vite+ Node.js manager enabled, its shims search the current directory and its parents for `.node-version`, `package.json#devEngines.runtime`, `package.json#engines.node`, and `.nvmrc`, in that order. If the project does not declare a version, Vite+ uses the user-level default. Set this default with `vp env default <version>`. If no user-level default exists, Vite+ uses the latest LTS release.

`working-directory` applies to the action. Each later workflow step keeps its own working directory. Vite+ searches for Node.js version sources from each command's current working directory. For a subproject, set `working-directory` on the step that runs `node` or `vp`.

`node-manager: false` skips Node.js shim creation and runs `vp env off`, so `vp` commands prefer the Node.js already on `PATH`. It cannot be combined with `node-version` or `node-version-file`.

## Outputs

| Output      | Description                              |
| ----------- | ---------------------------------------- |
| `version`   | The installed version of Vite+           |
| `cache-hit` | Boolean indicating if cache was restored |

## Caching

### Dependency Cache

When `cache: true` is set, the action additionally caches project dependencies by auto-detecting your lock file:

| Lock File           | Package Manager | Cache Directory |
| ------------------- | --------------- | --------------- |
| `pnpm-lock.yaml`    | pnpm            | pnpm store      |
| `bun.lockb`         | bun             | bun cache       |
| `bun.lock`          | bun             | bun cache       |
| `package-lock.json` | npm             | npm cache       |
| `yarn.lock`         | yarn            | yarn cache      |

The dependency cache key format is: `vite-plus-{OS}-{arch}-{pm}-{lockfile-hash}`

When `working-directory` is set, lockfile auto-detection runs in that directory.

When `cache-dependency-path` points to a lock file in a subdirectory, the action resolves the package-manager cache directory from that lock file's directory.

### Control cache saving

Set `cache-save: false` to restore an existing dependency cache without writing a new cache. The `cache` input remains the main switch for both operations:

| `cache` | `cache-save`      | Restore | Save |
| ------- | ----------------- | ------- | ---- |
| `false` | Any value         | No      | No   |
| `true`  | Omitted or `true` | Yes     | Yes  |
| `true`  | `false`           | Yes     | No   |

For example, this workflow restores caches on every run but saves them only from the `main` branch:

```yaml
- uses: voidzero-dev/setup-vp@v1.19.0
  with:
    cache: true
    cache-save: ${{ github.event_name == 'push' && github.ref == 'refs/heads/main' }}
```

Disabling cache saving doesn't change the `cache-hit` output, which continues to report whether the action restored a matching cache.

## GitLab CI/CD

setup-vp also provides a GitLab CI/CD remote template hosted from this GitHub repository. Because this repository is not a GitLab CI/CD component project, GitLab users should load it with `include:remote` instead of `include:component`.

See [GitLab integration notes](rfcs/gitlab-integration.md) for the design background, constraints, and follow-up work.

The dedicated [GitLab end-to-end test project](https://gitlab.com/fengmk2/setup-vp-gitlab-test) tests each setup-vp pull request, merge, and release. The pipeline loads the template, bootstrap script, and compiled runtime from the exact setup-vp commit or release tag that it tests.

### Basic GitLab Usage

Use an exact release tag in the `include:remote` URL, and pin `setup-ref` to the same tag so the bootstrap and compiled runtime are downloaded from the same version as the included template:

```yaml
include:
  - remote: "https://raw.githubusercontent.com/voidzero-dev/setup-vp/v1.19.0/gitlab/setup-vp.yml"
    inputs:
      setup-ref: "v1.19.0"

test:
  extends: .setup-vp
  image: node:24
  script:
    - vp run test
```

### With GitLab Inputs

```yaml
include:
  - remote: "https://raw.githubusercontent.com/voidzero-dev/setup-vp/v1.19.0/gitlab/setup-vp.yml"
    inputs:
      setup-ref: "v1.19.0"
      version: "latest"
      working-directory: "web"
      run-install: "true"

test:
  extends: .setup-vp
  image: node:24
  script:
    - vp run test
```

### With Existing GitLab `before_script`

GitLab replaces array keywords such as `before_script` when a job uses `extends`; it does not append them. If the job already needs setup commands, reference `.setup-vp-bootstrap` explicitly before the job-specific commands and configure setup-vp with variables:

```yaml
include:
  - remote: "https://raw.githubusercontent.com/voidzero-dev/setup-vp/v1.19.0/gitlab/setup-vp.yml"

test:
  image: node:24
  variables:
    SETUP_VP_VERSION: "latest"
    SETUP_VP_RUN_INSTALL: "true"
    SETUP_VP_SETUP_REF: "v1.19.0"
  before_script:
    - !reference [.setup-vp-bootstrap, before_script]
    - npm config set //registry.example.com/:_authToken "$NODE_AUTH_TOKEN"
    - corepack enable
  script:
    - vp run test
```

Use the same pattern when the project has `default:before_script`; put the shared setup commands in each job that needs them instead of relying on `.setup-vp` to append to the default array. The bootstrap variables match the GitLab inputs with `SETUP_VP_` prefixes, for example `SETUP_VP_WORKING_DIRECTORY`, `SETUP_VP_SFW`, `SETUP_VP_REGISTRY_URL`, and `SETUP_VP_SCOPE`.

### Advanced GitLab Run Install

```yaml
include:
  - remote: "https://raw.githubusercontent.com/voidzero-dev/setup-vp/v1.19.0/gitlab/setup-vp.yml"
    inputs:
      setup-ref: "v1.19.0"
      run-install: |
        - cwd: ./packages/app
          args: ['--frozen-lockfile']
        - cwd: ./packages/lib

test:
  extends: .setup-vp
  image: node:24
  script:
    - vp run test
```

### With GitLab Socket Firewall Free (sfw)

```yaml
include:
  - remote: "https://raw.githubusercontent.com/voidzero-dev/setup-vp/v1.19.0/gitlab/setup-vp.yml"
    inputs:
      setup-ref: "v1.19.0"
      sfw: true
      run-install: "true"

test:
  extends: .setup-vp
  image: node:24
  script:
    - vp run test
```

### With Private Registry

Pass `NODE_AUTH_TOKEN` as a GitLab CI/CD variable and set `registry-url` when the job needs an authenticated npm registry:

```yaml
include:
  - remote: "https://raw.githubusercontent.com/voidzero-dev/setup-vp/v1.19.0/gitlab/setup-vp.yml"
    inputs:
      setup-ref: "v1.19.0"
      registry-url: "https://npm.pkg.github.com"
      scope: "@myorg"

test:
  extends: .setup-vp
  image: node:24
  variables:
    NODE_AUTH_TOKEN: "$NPM_TOKEN"
  script:
    - vp run test
```

### GitLab Inputs

| Input               | Description                                                                                                                                                                                 | Default   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `version`           | Version of Vite+ to install                                                                                                                                                                 | `latest`  |
| `working-directory` | Project directory used for relative paths and default `vp install` execution                                                                                                                | `.`       |
| `run-install`       | String input for `vp install` after setup. Use `"true"`/`"false"` or a YAML object/list with `cwd`/`args`                                                                                   | `true`    |
| `sfw`               | Wrap `vp install` with [Socket Firewall Free](https://docs.socket.dev/docs/socket-firewall-free)                                                                                            | `false`   |
| `node-manager`      | String input: `"false"` keeps the runner image's Node.js (skips shims and runs `vp env off`); `"true"` force-enables the managed Node.js; empty lets the installer decide (enabled on CI)   |           |
| `registry-url`      | Optional registry URL to write to a temporary `.npmrc`                                                                                                                                      |           |
| `scope`             | Optional scope for authenticating against scoped registries                                                                                                                                 |           |
| `setup-ref`         | setup-vp ref used to download the GitLab bootstrap and compiled runtime. Always set it to the same tag as the remote URL; the default is the latest release when the template was published | `v1.19.0` |

### GitLab Notes

- Use an exact release tag such as `v1.19.0` in the remote URL. Do not use `main` (mutable) or `v1` (frozen at v1.15.0, no longer updated).
- Always pin `setup-ref` to the same tag or commit SHA as the remote URL, so the compiled runtime matches the included template.
- Quote GitLab string inputs such as `run-install: "false"`; unquoted booleans are rejected by GitLab before the setup runtime can parse them.
- GitLab 17.9+ users can add `integrity` to pin the remote file hash.
- The template expects a Unix-like runner image with Node.js, `bash`, and either `curl` or `wget`.
- The GitLab runtime source is TypeScript under `src/gitlab/`, but the template downloads and runs the `vp pack` generated JavaScript bundle from `dist/gitlab/index.mjs`.
- The GitLab template does not set up Node.js. Use a Node image such as `node:24`, or install Node.js before extending `.setup-vp`. The Vite+ installer still enables its own Node.js manager on CI; set `node-manager: "false"` to keep the image's Node.js for `vp` commands.
- The GitLab template intentionally does not expose `cache` or `cache-dependency-path` inputs. GitLab restores job cache before `before_script`, so this template cannot compute cache paths during setup and restore them for the same job. Configure GitLab `cache:` directly on the job when needed.

## Azure Pipelines

setup-vp also provides an Azure Pipelines step template hosted from this GitHub repository. Azure cannot execute the GitHub Action bundle directly, so the template downloads a compiled runtime (`dist/azure/index.mjs`) and runs it in `prepare` and `finalize` phases around Azure's native `Cache@2` task.

See [Azure Pipelines integration notes](rfcs/azure-pipelines-integration.md) for the design background, parity table, and cache semantics.

### Basic Azure Usage

Create a GitHub service connection named `github`, then reference the template from this repository:

```yaml
resources:
  repositories:
    - repository: setupVp
      type: github
      endpoint: github
      name: voidzero-dev/setup-vp
      ref: refs/tags/v1.19.0

pool:
  vmImage: ubuntu-latest

steps:
  - checkout: self

  - template: azure/setup-vp.yml@setupVp
    parameters:
      setupRef: v1.19.0
      nodeVersion: 24.x
      cache: true
      runInstall: true

  - script: vp run test
```

Pin `ref` and `setupRef` to the same exact tag or commit SHA. Do not use the `v1` tag: it is frozen at v1.15.0 and no longer updated.

### Azure Parameters

| Parameter             | Default   | Description                                                                                                                                                                   |
| --------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `version`             | `latest`  | Vite+ version/dist-tag passed to the official installer.                                                                                                                      |
| `workingDirectory`    | `.`       | Project directory for lock detection and default `vp install`.                                                                                                                |
| `runInstall`          | `true`    | Run `vp install`; accepts boolean or object/list with `cwd` and `args`.                                                                                                       |
| `sfw`                 | `false`   | Wrap `vp install` with Socket Firewall Free.                                                                                                                                  |
| `registryUrl`         |           | Optional registry URL for a temporary `.npmrc`.                                                                                                                               |
| `scope`               |           | Optional npm registry scope.                                                                                                                                                  |
| `setupRef`            | `v1.19.0` | Ref used to download bootstrap scripts and `dist/azure/index.mjs`. Always set it to the same tag as `ref`; the default is the latest release when the template was published. |
| `nodeVersion`         | `24.x`    | Passed to `UseNode@1`; an empty string skips Node setup.                                                                                                                      |
| `nodeManager`         |           | Control Vite+'s Node.js manager: `false` keeps the agent's Node.js (e.g. from `UseNode@1`); `true` force-enables the managed one; empty lets the installer decide.            |
| `cache`               | `false`   | Enable Azure `Cache@2` around the package-manager cache directory.                                                                                                            |
| `cacheDependencyPath` |           | Explicit lock file relative to `workingDirectory`; otherwise auto-detect.                                                                                                     |

### Azure Job Variables

| Variable                     | Purpose                                                               |
| ---------------------------- | --------------------------------------------------------------------- |
| `SETUP_VP_INSTALLED_VERSION` | Installed global Vite+ version (`unknown` when parsing fails).        |
| `SETUP_VP_CACHE_HIT`         | `true`, `inexact`, or `false` from `Cache@2` when caching is enabled. |

`vp`, `NPM_CONFIG_USERCONFIG`, and `PNPM_CONFIG_USERCONFIG` are available to later steps in the same job. Define `NODE_AUTH_TOKEN` as an Azure secret pipeline variable when private registry auth is required; the template maps it into both finalize tasks.

### Azure Notes

- The template supports Microsoft-hosted Linux, macOS, and Windows agents.
- `Cache@2` restores before `vp install` and saves automatically in a post-job step.
- Missing lock files or cache paths degrade to a warning and `SETUP_VP_CACHE_READY=false` instead of failing setup.
- For Azure Artifacts feeds, compose with Azure's `npmAuthenticate` task and/or pass `registryUrl` plus `NODE_AUTH_TOKEN`.

## Example Workflow

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6

      - uses: voidzero-dev/setup-vp@v1.19.0
        with:
          node-version: "lts"
          cache: true

      - run: vp run build

      - run: vp run test
```

## Development

### Install Vite+ CLI

- **Linux / macOS:** `curl -fsSL https://viteplus.dev/install.sh | bash`
- **Windows:** `irm https://viteplus.dev/install.ps1 | iex`

### Setup

```bash
git clone https://github.com/voidzero-dev/setup-vp.git
cd setup-vp
vp install
```

### Available Commands

| Command             | Description              |
| ------------------- | ------------------------ |
| `vp run build`      | Build (outputs to dist/) |
| `vp run test`       | Run tests                |
| `vp run test:watch` | Run tests in watch mode  |
| `vp run typecheck`  | Type check               |
| `vp run check`      | Lint + format check      |
| `vp run check:fix`  | Auto-fix lint/format     |

### Before Committing

- Run `vp run check:fix` and `vp run build`
- Generated files under `dist/` must be committed, including `dist/index.mjs` for the GitHub Action, `dist/gitlab/index.mjs` for the GitLab template, and `dist/azure/index.mjs` for the Azure Pipelines runtime
- Pre-commit hooks (via husky + lint-staged) will automatically run `vp check --fix` on staged files via `vpx lint-staged`

### Releasing

Releases are published as git tags; there is no npm package, but the `package.json` version tracks the latest release. Consumers pin an exact version tag such as `voidzero-dev/setup-vp@v1.19.0` or a commit SHA. The `v1` major tag is frozen at v1.15.0 and is never moved (an org-level ruleset rejects tag force-pushes).

To cut a release:

1. Open and merge a PR that bumps the upcoming version in `package.json`, the README examples, and the `setup-ref` / `setupRef` defaults in `gitlab/setup-vp.yml` and `azure/setup-vp.yml` (with the matching assertion in `src/azure/template.test.ts`).

2. Update `main` and confirm `dist/index.mjs` is in sync (the working tree must stay clean after building):

   ```bash
   git checkout main && git pull --ff-only
   vp run build
   git status --short   # must be empty
   ```

3. Confirm that the release commit on `main` passes the full GitLab E2E workflow.

4. Create the new annotated version tag and push it. For example:

   ```bash
   git tag -a v1.19.0 -m "v1.19.0"
   git push origin v1.19.0
   ```

## Feedback

If you have any feedback or issues, please [submit an issue](https://github.com/voidzero-dev/setup-vp/issues).

## License

[MIT](LICENSE)
