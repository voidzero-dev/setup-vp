# RFC: setup-vp Azure Pipelines Step Template

## Summary

This RFC adds an Azure Pipelines step template for `voidzero-dev/setup-vp`. Azure users install Vite+, optionally select Node.js, restore and save the Vite+ package-manager cache through Azure `Cache@2`, optionally run `vp install`, and can use Socket Firewall Free and private npm registry authentication.

The template is published from this GitHub repository as:

```text
azure/setup-vp.yml
azure/bootstrap.sh
azure/bootstrap.ps1
src/azure/*.ts
src/ci/*.ts
dist/azure/index.mjs
```

Consumers reference it through `resources.repositories` and a GitHub service connection:

```yaml
resources:
  repositories:
    - repository: setupVp
      type: github
      endpoint: github
      name: voidzero-dev/setup-vp
      ref: refs/tags/v1.16.0

steps:
  - template: azure/setup-vp.yml@setupVp
    parameters:
      setupRef: v1.16.0
```

## Motivation

`setup-vp` already ships a GitHub Action and a GitLab remote template. Azure Pipelines cannot execute the GitHub Action bundle because it depends on GitHub-specific inputs, state, outputs, and post-action cache APIs.

The GitLab integration established the right pattern: a provider-native template plus a dependency-light compiled runtime. Azure differs in two important ways:

1. External templates from GitHub require a service connection.
2. Azure `Cache@2` restores immediately and saves in a post-job step, so setup-vp must prepare cache metadata before the cache task and run `vp install` after it.

## Goals

1. Provide an Azure-native step template from this repository only.
2. Support Microsoft-hosted Linux, macOS, and Windows agents.
3. Keep Azure parameter names close to the GitHub Action inputs while using Azure camelCase.
4. Install Vite+ from the official installer with retry and fallback URLs.
5. Support structured `runInstall` entries with `cwd` and `args`.
6. Support private registry auth through `registryUrl`, `scope`, and `NODE_AUTH_TOKEN`.
7. Support `sfw: true` for `vp install`, including Windows assets.
8. Support Azure `Cache@2` around the package-manager cache directory.
9. Document parity gaps explicitly.

## Non-Goals

1. Do not publish an Azure DevOps Marketplace extension in this release.
2. Do not run `dist/index.mjs` inside Azure Pipelines.
3. Do not add `versionFile` or `nodeVersionFile` inputs in this release.
4. Do not change GitHub Action or GitLab template behavior.

## Design

### Distribution Model

Azure expands `azure/setup-vp.yml` from the external repository but does not check out bootstrap/runtime files onto the agent. Each prepare step downloads `azure/bootstrap.*` from `https://raw.githubusercontent.com/voidzero-dev/setup-vp/<setupRef>/azure/` into `Agent.TempDirectory`, then executes it. The bootstrap downloads `dist/azure/index.mjs` and runs `node <runtime> prepare`.

The prepare and finalize steps use the same deterministic runtime path under
`$(Agent.TempDirectory)/setup-vp-azure/dist/azure/index.mjs`. The runtime is
built as a standalone entrypoint, so downloading that file is sufficient. The
bootstrap also recognizes generated sibling chunks for compatibility with older
refs, and places them beside the runtime when present; finalize therefore does
not depend on cross-step macro expansion of a runtime path.

Pin `ref` and `setupRef` to the same immutable tag or commit SHA for strict reproducibility.

### Execution Flow

1. Optional `UseNode@1` when `nodeVersion` is non-empty.
2. `prepare`: install Vite+, prepend Vite+ bin to PATH, compute cache metadata.
3. Optional `Cache@2` when `cache: true` and `SETUP_VP_CACHE_READY=true`.
4. `finalize`: configure npm auth, install/reuse `sfw`, run `vp install`, emit `SETUP_VP_INSTALLED_VERSION`.

### Shared Portable Runtime

Provider-independent logic lives in `src/ci/` and is reused by GitLab (`src/gitlab/`) and Azure (`src/azure/`). Azure-specific logging uses `##vso[task.setvariable]` and `##vso[task.prependpath]`.

## Public API

| Parameter             | Default  | GitHub/GitLab equivalent |
| --------------------- | -------- | ------------------------ |
| `version`             | `latest` | `version`                |
| `workingDirectory`    | `.`      | `working-directory`      |
| `runInstall`          | `true`   | `run-install`            |
| `sfw`                 | `false`  | `sfw`                    |
| `registryUrl`         |          | `registry-url`           |
| `scope`               |          | `scope`                  |
| `setupRef`            | `v1`     | `setup-ref`              |
| `nodeVersion`         | `24.x`   | `node-version`           |
| `cache`               | `false`  | `cache`                  |
| `cacheDependencyPath` |          | `cache-dependency-path`  |

Provider-visible variables:

| Variable                     | Purpose                                      |
| ---------------------------- | -------------------------------------------- |
| `SETUP_VP_INSTALLED_VERSION` | Installed global Vite+ version               |
| `SETUP_VP_CACHE_HIT`         | `true`, `inexact`, or `false` from `Cache@2` |

For private registries, consumers define `NODE_AUTH_TOKEN` as an Azure secret
pipeline variable. Both finalize branches explicitly map that secret into the
runtime environment before configuring registry authentication.

## GitHub/GitLab/Azure Parity

| Capability              | GitHub Action | GitLab template | Azure template    |
| ----------------------- | ------------- | --------------- | ----------------- |
| Install Vite+           | Yes           | Yes             | Yes               |
| `node-version`          | Yes           | No              | Yes (`UseNode@1`) |
| `node-version-file`     | Yes           | No              | No                |
| `version-file`          | Yes           | No              | No                |
| `working-directory`     | Yes           | Yes             | Yes               |
| `run-install`           | Yes           | Yes             | Yes               |
| `registry-url`          | Yes           | Yes             | Yes               |
| `scope`                 | Yes           | Yes             | Yes               |
| `sfw`                   | Yes           | Yes (Unix)      | Yes (all OS)      |
| `cache`                 | Yes           | No              | Yes (`Cache@2`)   |
| `cache-dependency-path` | Yes           | No              | Yes               |

## Cache Design

When `cache: true`, prepare detects the lock file, resolves `vp pm cache dir`, and emits:

- `SETUP_VP_CACHE_READY`
- `SETUP_VP_CACHE_PATH`
- `SETUP_VP_LOCK_FILE`
- `SETUP_VP_LOCK_TYPE`

`Cache@2` runs only when `SETUP_VP_CACHE_READY=true`. Missing lock files or cache paths log a warning and skip caching without failing setup.

## Rollout

1. Land the template, runtime, docs, and repository CI smoke coverage.
2. Validate on real Azure Pipelines agents before release.
3. After merge and tag, run one consumer pipeline using the public external-repository template plus matching immutable `setupRef`.
