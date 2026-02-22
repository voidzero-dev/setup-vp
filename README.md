# setup-vite-plus-action

GitHub Action to set up [Vite+](https://github.com/voidzero-dev/vite-plus) (`vp`) with dependency caching support.

## Features

- Install Vite+ globally via official install scripts
- Optionally set up a specific Node.js version via `vp env use`
- Cache project dependencies with auto-detection of lock files
- Optionally run `vp install` after setup
- Support for all major package managers (npm, pnpm, yarn)

## Usage

### Basic Usage

```yaml
steps:
  - uses: actions/checkout@v6
  - uses: voidzero-dev/setup-vite-plus-action@v1
```

### With Node.js Version

```yaml
steps:
  - uses: actions/checkout@v6
  - uses: voidzero-dev/setup-vite-plus-action@v1
    with:
      node-version: '22'
```

### With Caching and Install

```yaml
steps:
  - uses: actions/checkout@v6
  - uses: voidzero-dev/setup-vite-plus-action@v1
    with:
      node-version: '22'
      cache: true
      run-install: true
```

### Specific Version

```yaml
steps:
  - uses: actions/checkout@v6
  - uses: voidzero-dev/setup-vite-plus-action@v1
    with:
      version: '1.2.3'
      node-version: '22'
      cache: true
```

### Advanced Run Install

```yaml
steps:
  - uses: actions/checkout@v6
  - uses: voidzero-dev/setup-vite-plus-action@v1
    with:
      node-version: '22'
      cache: true
      run-install: |
        - cwd: ./packages/app
          args: ['--frozen-lockfile']
        - cwd: ./packages/lib
```

### Matrix Testing with Multiple Node.js Versions

```yaml
jobs:
  test:
    strategy:
      matrix:
        node-version: ['20', '22', '24']
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: voidzero-dev/setup-vite-plus-action@v1
        with:
          node-version: ${{ matrix.node-version }}
          cache: true
      - run: vp run test
```

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `version` | Version of Vite+ to install | No | `latest` |
| `node-version` | Node.js version to install via `vp env use` | No | Vite+ default |
| `run-install` | Run `vp install` after setup. Accepts boolean or YAML object with `cwd`/`args` | No | `true` |
| `cache` | Enable caching of project dependencies | No | `false` |
| `cache-dependency-path` | Path to lock file for cache key generation | No | Auto-detected |

## Outputs

| Output | Description |
|--------|-------------|
| `version` | The installed version of Vite+ |
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

      - uses: voidzero-dev/setup-vite-plus-action@v1
        with:
          node-version: '22'
          cache: true

      - run: vp run build

      - run: vp run test
```

## Feedback

If you have any feedback or issues, please [submit an issue or start a discussion](https://github.com/voidzero-dev/vite-plus-discussions).

## License

MIT
