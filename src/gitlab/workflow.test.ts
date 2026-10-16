import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { parse as parseYaml } from "yaml";

const workflow = parseYaml(
  readFileSync(new URL("../../.github/workflows/gitlab-e2e.yml", import.meta.url), "utf8"),
);
const steps = workflow.jobs["gitlab-e2e"].steps as Array<{
  id?: string;
  uses?: string;
  env?: Record<string, string>;
  run: string;
}>;
const parameters = steps.find((step) => step.id === "parameters")!;
const headSha = "a".repeat(40);
const baseSha = "b".repeat(40);
const tempDirs: string[] = [];

type ParameterResult = SpawnSyncReturns<string> & {
  outputs: Record<string, string>;
  calls: string;
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function resolveParameters(overrides: Record<string, string | undefined> = {}): ParameterResult {
  const dir = mkdtempSync(join(tmpdir(), "setup-vp-gitlab-workflow-"));
  tempDirs.push(dir);
  const output = join(dir, "output");
  const calls = join(dir, "calls");
  for (const file of [output, calls]) writeFileSync(file, "");
  writeFileSync(
    join(dir, "gh"),
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$MOCK_GH_CALLS"
if [ "$MOCK_GH_FAILURE" = true ] || [[ -n "$MOCK_GH_FAILURE" && "$*" == *"$MOCK_GH_FAILURE"* ]]; then exit 1; fi
case "$*" in
  "api repos/upstream/setup-vp/collaborators/reviewer/permission --jq .permission") printf '%s\\n' "$MOCK_PERMISSION" ;;
  "api repos/upstream/setup-vp/pulls/123") printf '%s\\n' "$MOCK_PR" ;;
  *) exit 90 ;;
esac
`,
    { mode: 0o755 },
  );
  const result = spawnSync("bash", ["-c", parameters.run], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      GH_TOKEN: "test-token",
      GITHUB_OUTPUT: output,
      GITHUB_REPOSITORY: "upstream/setup-vp",
      GITHUB_SHA: baseSha,
      EVENT_NAME: "workflow_dispatch",
      EVENT_ACTION: "",
      EVENT_LABEL: "",
      LABEL_ACTOR: "reviewer",
      PR_NUMBER: "",
      SETUP_REF: "",
      TEST_SUITE: "",
      VITE_PLUS_VERSION: "",
      MOCK_GH_CALLS: calls,
      MOCK_GH_FAILURE: "false",
      MOCK_PERMISSION: "write",
      ...overrides,
    },
  });
  return {
    ...result,
    outputs: Object.fromEntries(
      readFileSync(output, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => line.split("=")),
    ),
    calls: readFileSync(calls, "utf8"),
  };
}

describe("GitLab E2E requests", () => {
  it("limits label runs to same-repository PRs and manual runs to main", () => {
    expect(Object.keys(workflow.on)).toEqual(["pull_request", "workflow_dispatch"]);
    expect(workflow.on.pull_request).toEqual({ branches: ["main"], types: ["labeled"] });
    expect(workflow.on.workflow_dispatch.inputs.pull_request).toEqual(
      expect.objectContaining({ required: false, default: "" }),
    );
    expect(Object.keys(workflow.jobs)).toEqual(["gitlab-e2e"]);
    expect(workflow.jobs["gitlab-e2e"].if.replace(/\s+/g, " ")).toBe(
      "(github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main') || " +
        "(github.event_name == 'pull_request' && github.event.action == 'labeled' && " +
        "github.event.label.name == 'run-e2e' && " +
        "github.event.pull_request.head.repo.full_name == github.repository)",
    );
    expect(workflow.permissions).toEqual({ contents: "read", "pull-requests": "read" });
    expect(steps.every((step) => !step.uses && !step.run.includes("${{"))).toBe(true);
    expect(parameters.env).toEqual({
      EVENT_NAME: "${{ github.event_name }}",
      EVENT_ACTION: "${{ github.event.action }}",
      EVENT_LABEL: "${{ github.event.label.name }}",
      LABEL_ACTOR: "${{ github.event.sender.login }}",
      PR_NUMBER: "${{ github.event.pull_request.number || inputs.pull_request }}",
      SETUP_REF: "${{ github.event.pull_request.head.sha || inputs.setup_ref }}",
      TEST_SUITE: "${{ inputs.suite }}",
      VITE_PLUS_VERSION: "${{ inputs.vite_plus_version }}",
      GH_TOKEN: "${{ github.token }}",
    });
    expect(existsSync(new URL("../../.github/workflows/e2e-request.yml", import.meta.url))).toBe(
      false,
    );
    const trigger = steps.find((step) => step.id === "trigger")!;
    expect(trigger.env?.GITLAB_TRIGGER_TOKEN).toBe("${{ secrets.GITLAB_TRIGGER_TOKEN }}");
    expect(trigger.run).toContain("$GITHUB_STEP_SUMMARY");
    expect(steps.at(-1)!.run).toContain("GitLab pipeline finished with status");
  });

  it.each([
    ["defaults", {}, baseSha, "full", "latest"],
    [
      "overrides",
      { SETUP_REF: headSha, TEST_SUITE: "required", VITE_PLUS_VERSION: "0.3.1" },
      headSha,
      "required",
      "0.3.1",
    ],
    ["release tag", { SETUP_REF: "v1.20.0" }, "v1.20.0", "full", "latest"],
    ["prerelease tag", { SETUP_REF: "v1.20.0-beta.1" }, "v1.20.0-beta.1", "full", "latest"],
  ])("preserves standalone run %s", (_name, env, ref, suite, version) => {
    const result = resolveParameters(env);
    expect(result.status, result.stderr).toBe(0);
    expect(result.outputs).toEqual({ setup_vp_ref: ref, suite, vite_plus_version: version });
    expect(result.calls).toBe("");
  });

  it.each([
    { SETUP_REF: "main" },
    { SETUP_REF: "$(exit 1)" },
    { SETUP_REF: `${headSha}\nextra=true` },
    { TEST_SUITE: "unknown" },
    { VITE_PLUS_VERSION: "latest\nextra=true" },
    { VITE_PLUS_VERSION: "latest\rextra=true" },
    { PR_NUMBER: "-1", SETUP_REF: headSha },
    { PR_NUMBER: "123\n", SETUP_REF: headSha },
    { PR_NUMBER: "123" },
    { PR_NUMBER: "123", SETUP_REF: "v1.20.0" },
  ])("rejects invalid dispatch inputs %j before API access or outputs", (env) => {
    const result = resolveParameters(env);
    expect(result.status).toBe(1);
    expect(result.outputs).toEqual({});
    expect(result.calls).toBe("");
  });
});

describe("GitLab E2E label approval", () => {
  const approvedPr = {
    state: "open",
    head: { sha: headSha, repo: { full_name: "upstream/setup-vp" } },
    base: { ref: "main", repo: { full_name: "upstream/setup-vp" } },
    labels: [{ name: "run-e2e" }],
  };
  function resolveLabel(overrides: Record<string, string | undefined> = {}) {
    return resolveParameters({
      EVENT_NAME: "pull_request",
      EVENT_ACTION: "labeled",
      EVENT_LABEL: "run-e2e",
      PR_NUMBER: "123",
      SETUP_REF: headSha,
      MOCK_PR: JSON.stringify(approvedPr),
      ...overrides,
    });
  }

  it.each(["write", "admin"])("accepts a labeler with %s access", (permission) => {
    const result = resolveLabel({
      MOCK_PERMISSION: permission,
      TEST_SUITE: "required",
      VITE_PLUS_VERSION: "0.3.1",
      GITHUB_ACTOR: "rerunner",
      GITHUB_TRIGGERING_ACTOR: "rerunner",
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.outputs).toEqual({
      setup_vp_ref: headSha,
      suite: "full",
      vite_plus_version: "latest",
    });
    expect(result.calls).toBe(
      "api repos/upstream/setup-vp/collaborators/reviewer/permission --jq .permission\n" +
        "api repos/upstream/setup-vp/pulls/123\n",
    );
  });

  it.each(["read", "triage", "none", ""])("rejects a labeler with %s access", (permission) => {
    const result = resolveLabel({ MOCK_PERMISSION: permission });
    expect(result.status).toBe(1);
    expect(result.outputs).toEqual({});
    expect(result.calls).not.toContain("/pulls/");
  });

  it.each([
    { EVENT_NAME: "push" },
    { EVENT_NAME: "pull_request_target" },
    { EVENT_ACTION: "synchronize" },
    { EVENT_ACTION: "unlabeled" },
    { EVENT_LABEL: "bug" },
    { PR_NUMBER: "" },
    { PR_NUMBER: "123\n" },
    { SETUP_REF: "" },
    { SETUP_REF: "v1.20.0" },
    { SETUP_REF: `${headSha}\nextra=true` },
  ])("rejects an invalid label event %j before API access", (env) => {
    const result = resolveLabel(env);
    expect(result.status).toBe(1);
    expect(result.outputs).toEqual({});
    expect(result.calls).toBe("");
  });

  it.each([
    ["new commit", { head: { ...approvedPr.head, sha: baseSha } }],
    ["fork", { head: { ...approvedPr.head, repo: { full_name: "contributor/setup-vp" } } }],
    ["deleted repository", { head: { ...approvedPr.head, repo: null } }],
    ["base change", { base: { ...approvedPr.base, ref: "release" } }],
    ["closed PR", { state: "closed" }],
    ["removed label", { labels: [] }],
  ])("rejects a label request after a %s", (_reason, changes) => {
    const result = resolveLabel({ MOCK_PR: JSON.stringify({ ...approvedPr, ...changes }) });
    expect(result.status).toBe(1);
    expect(result.outputs).toEqual({});
  });

  it.each(["/permission", "/pulls/"])("fails closed if the %s API fails", (endpoint) => {
    const result = resolveLabel({ MOCK_GH_FAILURE: endpoint });
    expect(result.status).toBe(1);
    expect(result.outputs).toEqual({});
  });
});

describe.each(["upstream/setup-vp", "contributor/setup-vp"])(
  "GitLab E2E reviewed commit from %s",
  (headRepository) => {
    const approvedPr = {
      state: "open",
      head: { sha: headSha, repo: { full_name: headRepository } },
      base: { ref: "main", repo: { full_name: "upstream/setup-vp" } },
    };
    function resolveRequest(overrides: Record<string, string> = {}) {
      return resolveParameters({
        PR_NUMBER: "123",
        SETUP_REF: headSha,
        MOCK_PR: JSON.stringify(approvedPr),
        ...overrides,
      });
    }
    it("tests only the reviewed head, including PRs from forks", () => {
      const result = resolveRequest();
      expect(result.status, result.stderr).toBe(0);
      expect(result.outputs).toEqual({
        setup_vp_ref: headSha,
        suite: "full",
        vite_plus_version: "latest",
      });
      expect(result.calls).toBe("api repos/upstream/setup-vp/pulls/123\n");
    });
    it.each([
      ["new commit", { head: { ...approvedPr.head, sha: "c".repeat(40) } }],
      ["deleted fork", { head: { ...approvedPr.head, repo: null } }],
      ["base change", { base: { ...approvedPr.base, ref: "release" } }],
      [
        "different repository",
        { base: { ...approvedPr.base, repo: { full_name: "other/setup-vp" } } },
      ],
      ["closed PR", { state: "closed" }],
    ])("rejects a stale request after a %s", (_reason, changes) => {
      const result = resolveRequest({ MOCK_PR: JSON.stringify({ ...approvedPr, ...changes }) });
      expect(result.status).toBe(1);
      expect(result.outputs).toEqual({});
      expect(result.stdout).toContain("Review its current head");
    });
    it("fails closed when the PR API fails", () => {
      const result = resolveRequest({ MOCK_GH_FAILURE: "true" });
      expect(result.status).toBe(1);
      expect(result.outputs).toEqual({});
    });
  },
);
