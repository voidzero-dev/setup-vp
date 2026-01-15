# setup-vite-plus-action

GitHub Action to set up [Vite+](https://github.com/voidzero-dev/vite-plus) (`vite-plus-cli`) with dependency caching support.

## Features

- Install Vite+ globally with version specification
- Cache project dependencies with auto-detection of lock files
- Optionally run `vite install` after setup
- Support for all major package managers (npm, pnpm, yarn)

## Requirements

- Node.js >= 22.12.0 (use [actions/setup-node](https://github.com/actions/setup-node) first)

## Usage

### Basic Usage

```yaml
steps:
  - uses: actions/checkout@v6
  - uses: actions/setup-node@v6
    with:
      node-version: '22'
  - uses: voidzero-dev/setup-vite-plus-action@v1
```

### With Caching and Install

```yaml
steps:
  - uses: actions/checkout@v6
  - uses: actions/setup-node@v6
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
  - uses: actions/checkout@v6
  - uses: actions/setup-node@v6
    with:
      node-version: '22'
  - uses: voidzero-dev/setup-vite-plus-action@v1
    with:
      version: '1.2.3'
      cache: true
```

### Advanced Run Install

```yaml
steps:
  - uses: actions/checkout@v6
  - uses: actions/setup-node@v6
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
| `version` | Version of vite-plus-cli to install | No | `latest` |
| `run-install` | Run `vite install` after setup. Accepts boolean or YAML object with `cwd`/`args` | No | `true` |
| `cache` | Enable caching of project dependencies | No | `false` |
| `cache-dependency-path` | Path to lock file for cache key generation | No | Auto-detected |

## Outputs

| Output | Description |
|--------|-------------|
| `version` | The installed version of vite-plus-cli |
| `cache-hit` | Boolean indicating if cache was restored |

## Caching

When `cache: true` is set, the action automatically detects your lock file and caches the appropriate package manager store:

| Lock File | Package Manager | Cache Directory |
|-----------|-----------------|-----------------|
| `pnpm-lock.yaml` | pnpm | pnpm store |
| `package-lock.json` | npm | npm cache |
| `yarn.lock` | yarn | yarn cache |

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
      - uses: actions/checkout@v6

      - uses: actions/setup-node@v6
        with:
          node-version: '22'

      - uses: voidzero-dev/setup-vite-plus-action@v1
        with:
          cache: true

      - run: vite run build

      - run: vite run test
```

## Feedback

If you have any feedback or issues, please [submit an issue or start a discussion](https://github.com/voidzero-dev/vite-plus-discussions).

## License

MIT
