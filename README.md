# setup-vite-plus-action

GitHub Action to set up [Vite+](https://github.com/voidzero-dev/vite-plus) (`@voidzero-dev/global`) with dependency caching support.

## Features

- Install Vite+ globally with version specification
- Support both npm Registry and GitHub Package Registry
- Cache project dependencies with auto-detection of lock files
- Optionally run `vite install` after setup
- Support for all major package managers (npm, pnpm, yarn, bun)

## Requirements

- Node.js >= 22.12.0 (use [actions/setup-node](https://github.com/actions/setup-node) first)

## Usage

### Basic Usage

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: actions/setup-node@v4
    with:
      node-version: '22'
  - uses: voidzero-dev/setup-vite-plus-action@v1
```

### With Caching and Install

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: actions/setup-node@v4
    with:
      node-version: '22'
  - uses: voidzero-dev/setup-vite-plus-action@v1
    with:
      cache: true
      run-install: true
```

### Specific Version

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: actions/setup-node@v4
    with:
      node-version: '22'
  - uses: voidzero-dev/setup-vite-plus-action@v1
    with:
      version: '1.2.3'
      cache: true
```

### GitHub Package Registry

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: actions/setup-node@v4
    with:
      node-version: '22'
  - uses: voidzero-dev/setup-vite-plus-action@v1
    with:
      registry: github
      github-token: ${{ secrets.GH_PKG_TOKEN }}
```

### Advanced Run Install

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: actions/setup-node@v4
    with:
      node-version: '22'
  - uses: voidzero-dev/setup-vite-plus-action@v1
    with:
      cache: true
      run-install: |
        - cwd: ./packages/app
          args: ['--frozen-lockfile']
        - cwd: ./packages/lib
```

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `version` | Version of @voidzero-dev/global to install | No | `latest` |
| `registry` | Registry to install from: `npm` or `github` | No | `npm` |
| `github-token` | GitHub PAT for GitHub Package Registry | No | - |
| `run-install` | Run `vite install` after setup. Accepts boolean or YAML object with `cwd`/`args` | No | `true` |
| `cache` | Enable caching of project dependencies | No | `false` |
| `cache-dependency-path` | Path to lock file for cache key generation | No | Auto-detected |

## Outputs

| Output | Description |
|--------|-------------|
| `version` | The installed version of @voidzero-dev/global |
| `cache-hit` | Boolean indicating if cache was restored |

## Caching

When `cache: true` is set, the action automatically detects your lock file and caches the appropriate package manager store:

| Lock File | Package Manager | Cache Directory |
|-----------|-----------------|-----------------|
| `pnpm-lock.yaml` | pnpm | pnpm store |
| `package-lock.json` | npm | npm cache |
| `yarn.lock` | yarn | yarn cache |
| `bun.lockb` | bun | bun cache |

The cache key format is: `vite-plus-{OS}-{arch}-{pm}-{lockfile-hash}`

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
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '22'

      - uses: voidzero-dev/setup-vite-plus-action@v1
        with:
          cache: true
          run-install: true

      - run: vite run build

      - run: vite run test
```

## License

MIT
