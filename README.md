# setup-vp

GitHub Action to set up [Vite+](https://viteplus.dev) (`vp`) with dependency caching support.

## Features

- Install Vite+ globally via official install scripts
- Optionally set up a specific Node.js version via `vp env use`
- Cache project dependencies with auto-detection of lock files
- Optionally run `vp install` after setup
- Optionally wrap `vp install` with [Socket Firewall Free (`sfw`)](https://docs.socket.dev/docs/socket-firewall-free) to block malicious dependencies
- Support for all major package managers (npm, pnpm, yarn, bun)

## Usage

### Basic Usage

```yaml
steps:
  - uses: actions/checkout@v6
  - uses: voidzero-dev/setup-vp@v1
```

### With Node.js Version

```yaml
steps:
  - uses: actions/checkout@v6
  - uses: voidzero-dev/setup-vp@v1
    with:
      node-version: "lts"
```

### With Node.js Version File

```yaml
steps:
  - uses: actions/checkout@v6
  - uses: voidzero-dev/setup-vp@v1
    with:
      node-version-file: ".node-version"
```

### With Working Directory

```yaml
steps:
  - uses: actions/checkout@v6
  - uses: voidzero-dev/setup-vp@v1
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
  - uses: voidzero-dev/setup-vp@v1
    with:
      node-version: "lts"
      cache: true
      run-install: true
```

### Specific Version

```yaml
steps:
  - uses: actions/checkout@v6
  - uses: voidzero-dev/setup-vp@v1
    with:
      version: "1.2.3"
      node-version: "lts"
      cache: true
```

### Advanced Run Install

```yaml
steps:
  - uses: actions/checkout@v6
  - uses: voidzero-dev/setup-vp@v1
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
  - uses: voidzero-dev/setup-vp@v1
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
  - uses: voidzero-dev/setup-vp@v1
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
  - uses: voidzero-dev/setup-vp@v1
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
  - uses: voidzero-dev/setup-vp@v1
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
      - uses: voidzero-dev/setup-vp@v1
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
      - uses: voidzero-dev/setup-vp@v1
        with:
          node-version: ${{ matrix.node-version }}
          cache: true
      - run: vp run test
```

## Inputs

| Input                   | Description                                                                                                 | Required | Default        |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- | -------- | -------------- |
| `version`               | Version of Vite+ to install                                                                                 | No       | `latest`       |
| `node-version`          | Node.js version to install via `vp env use`                                                                 | No       | Latest LTS     |
| `node-version-file`     | Path to file containing Node.js version (`.nvmrc`, `.node-version`, `.tool-versions`, `package.json`)       | No       |                |
| `working-directory`     | Project directory used for relative paths, lockfile auto-detection, environment checks, and default install | No       | Workspace root |
| `run-install`           | Run `vp install` after setup. Accepts boolean or YAML object with `cwd`/`args`                              | No       | `true`         |
| `sfw`                   | Wrap `vp install` with [Socket Firewall Free](https://docs.socket.dev/docs/socket-firewall-free) (`sfw`)    | No       | `false`        |
| `cache`                 | Enable caching of project dependencies                                                                      | No       | `false`        |
| `cache-dependency-path` | Path to lock file for cache key generation                                                                  | No       | Auto-detected  |
| `registry-url`          | Optional registry to set up for auth. Sets the registry in `.npmrc` and reads auth from `NODE_AUTH_TOKEN`   | No       |                |
| `scope`                 | Optional scope for scoped registries. Falls back to repo owner for GitHub Packages                          | No       |                |

When `working-directory` is set, relative `run-install.cwd`, `node-version-file`, and `cache-dependency-path` values are resolved from that directory.

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

      - uses: voidzero-dev/setup-vp@v1
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
- The `dist/index.mjs` must be committed (it's the compiled action entry point)
- Pre-commit hooks (via husky + lint-staged) will automatically run `vp check --fix` on staged files via `vpx lint-staged`

## Feedback

If you have any feedback or issues, please [submit an issue](https://github.com/voidzero-dev/setup-vp/issues).

## License

[MIT](LICENSE)
