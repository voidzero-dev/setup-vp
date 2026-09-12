import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { parse as parseYaml } from "yaml";

const workflow = parseYaml(
  readFileSync(new URL("../../.github/workflows/gitlab-e2e.yml", import.meta.url), "utf8"),
);
const requestWorkflow = parseYaml(
  readFileSync(new URL("../../.github/workflows/e2e-request.yml", import.meta.url), "utf8"),
);
const steps = workflow.jobs["gitlab-e2e"].steps as Array<{
  id?: string;
  uses?: string;
  if?: string;
  env?: Record<string, string>;
  run: string;
}>;
const parameters = steps.find((step) => step.id === "parameters")!;
const headSha = "a".repeat(40);
const baseSha = "b".repeat(40);
const approvedPr = {
  state: "open",
  head: { sha: headSha, repo: { full_name: "contributor/setup-vp" } },
  base: { ref: "main", repo: { full_name: "upstream/setup-vp" } },
  labels: [{ name: "run-e2e" }],
};
const tempDirs: string[] = [];

type ParameterResult = SpawnSyncReturns<string> & {
  outputs: Record<string, string>;
  summary: string;
  calls: string;
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function resolveParameters(overrides: Record<string, string> = {}): ParameterResult {
  const dir = mkdtempSync(join(tmpdir(), "setup-vp-gitlab-workflow-"));
  tempDirs.push(dir);
  const output = join(dir, "output");
  const summary = join(dir, "summary");
  const calls = join(dir, "calls");
  for (const file of [output, summary, calls]) {
    writeFileSync(file, "");
  }
  writeFileSync(
    join(dir, "gh"),
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$MOCK_GH_CALLS"
if [ -n "$MOCK_GH_FAILURE" ] && [[ "$*" == *"$MOCK_GH_FAILURE"* ]]; then
  exit 1
fi
case "$*" in
  */permission*) printf '%s\\n' "$MOCK_PERMISSION" ;;
  *"contents/.github/workflows/e2e-request.yml?ref=$GITHUB_SHA"*) printf '%s\\n' trusted-blob ;;
  *"contents/.github/workflows/e2e-request.yml?ref=$REQUEST_HEAD_SHA"*) printf '%s\\n' "$MOCK_REQUEST_BLOB" ;;
  */files*) printf '%s\\n' "$MOCK_CHANGED_FILES" ;;
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
      GITHUB_STEP_SUMMARY: summary,
      GITHUB_REPOSITORY: "upstream/setup-vp",
      GITHUB_SHA: baseSha,
      GITHUB_ACTOR: "rerunner",
      EVENT_NAME: "workflow_run",
      REQUEST_EVENT: "pull_request",
      REQUEST_CONCLUSION: "success",
      REQUEST_PATH: ".github/workflows/e2e-request.yml",
      REQUEST_TITLE: `PR #123: labeled run-e2e at ${headSha}`,
      REQUEST_ACTOR: "reviewer",
      REQUEST_HEAD_SHA: headSha,
      REQUEST_HEAD_REPOSITORY: "contributor/setup-vp",
      EVENT_REF: "refs/heads/main",
      EVENT_REF_NAME: "main",
      PR_HEAD_REPOSITORY: "contributor/setup-vp",
      PR_HEAD_SHA: headSha,
      PR_NUMBER: "123",
      MANUAL_SETUP_REF: "",
      MANUAL_SUITE: "",
      MANUAL_VITE_PLUS_VERSION: "",
      MOCK_GH_CALLS: calls,
      MOCK_GH_FAILURE: "",
      MOCK_PERMISSION: "write",
      MOCK_REQUEST_BLOB: "trusted-blob",
      MOCK_PR: JSON.stringify(approvedPr),
      MOCK_CHANGED_FILES: "README.md",
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
    summary: readFileSync(summary, "utf8"),
    calls: readFileSync(calls, "utf8"),
  };
}

describe("GitLab E2E workflow", () => {
  it("only accepts label events for privileged fork runs and never checks out PR code", () => {
    expect(workflow.on).not.toHaveProperty("pull_request_target");
    expect(requestWorkflow.on).toEqual({
      pull_request: { branches: ["main"], types: ["labeled"] },
    });
    expect(requestWorkflow.permissions).toEqual({});
    expect(workflow.on.workflow_run).toEqual({
      workflows: [requestWorkflow.name],
      types: ["completed"],
    });
    expect(requestWorkflow["run-name"]).toBe(
      "PR #${{ github.event.pull_request.number }}: ${{ github.event.action }} ${{ github.event.label.name }} at ${{ github.event.pull_request.head.sha }}",
    );
    expect(workflow.permissions).toEqual({ contents: "read", "pull-requests": "read" });
    expect(steps.every((step) => !step.uses && !step.run.includes("${{"))).toBe(true);
    expect(parameters.env?.REQUEST_HEAD_SHA).toBe("${{ github.event.workflow_run.head_sha }}");
    expect(parameters.env?.REQUEST_ACTOR).toBe("${{ github.event.workflow_run.actor.login }}");
    for (const step of steps.slice(1)) {
      expect(step.if).toBe("steps.parameters.outputs.should_run == 'true'");
    }
  });

  it.each(["write", "admin"])(
    "runs the full suite at the event SHA with %s access",
    (permission) => {
      const result = resolveParameters({ MOCK_PERMISSION: permission });
      expect(result.status, result.stderr).toBe(0);
      expect(result.outputs).toEqual({
        should_run: "true",
        setup_vp_ref: headSha,
        suite: "full",
        vite_plus_version: "latest",
        pr_number: "123",
      });
      expect(result.calls).toContain("collaborators/reviewer/permission");
      expect(result.calls).not.toContain("/files");
    },
  );

  it.each(["read", "none", ""])("rejects approval with %s permission", (permission) => {
    const result = resolveParameters({ MOCK_PERMISSION: permission });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("requires repository write access");
    expect(result.outputs.should_run).toBeUndefined();
    expect(result.calls).not.toContain("/pulls/");
  });

  it.each(["/permission", "/pulls/", `?ref=${baseSha}`, `?ref=${headSha}`])(
    "fails closed when the %s API request fails",
    (endpoint) => {
      const result = resolveParameters({ MOCK_GH_FAILURE: endpoint });
      expect(result.status).toBe(1);
      expect(result.outputs.should_run).toBeUndefined();
    },
  );

  it.each([
    ["new commit", { head: { ...approvedPr.head, sha: "c".repeat(40) } }],
    ["different fork", { head: { ...approvedPr.head, repo: { full_name: "other/setup-vp" } } }],
    ["base change", { base: { ...approvedPr.base, ref: "release" } }],
    [
      "different repository",
      { base: { ...approvedPr.base, repo: { full_name: "other/setup-vp" } } },
    ],
    ["closed PR", { state: "closed" }],
    ["removed label", { labels: [{ name: "other-label" }] }],
  ])("skips a stale approval after a %s", (_reason, changes) => {
    const result = resolveParameters({ MOCK_PR: JSON.stringify({ ...approvedPr, ...changes }) });
    expect(result.status, result.stderr).toBe(0);
    expect(result.outputs.should_run).toBe("false");
    expect(result.outputs.pr_number).toBe("");
    expect(result.summary).toContain("This approval is stale");
  });

  it.each([
    ["unrelated label", { REQUEST_TITLE: `PR #123: labeled bug at ${headSha}` }],
    ["new push", { REQUEST_TITLE: `PR #123: synchronize run-e2e at ${headSha}` }],
    ["same-repository PR", { REQUEST_HEAD_REPOSITORY: "upstream/setup-vp" }],
    ["different event", { REQUEST_EVENT: "push" }],
    ["failed request", { REQUEST_CONCLUSION: "failure" }],
    ["different workflow", { REQUEST_PATH: ".github/workflows/fake-request.yml" }],
    ["malformed title", { REQUEST_TITLE: "PR #123: labeled run-e2e at $(exit 1)" }],
  ])("does not approve a privileged run for a %s", (_reason, env) => {
    const result = resolveParameters(env);
    expect(result.status, result.stderr).toBe(0);
    expect(result.outputs.should_run).toBe("false");
    expect(result.outputs.pr_number).toBe("");
    expect(result.calls).toBe("");
  });

  it("rejects a title that claims a different commit than the request run", () => {
    const result = resolveParameters({ REQUEST_TITLE: `PR #123: labeled run-e2e at ${baseSha}` });
    expect(result.status).toBe(1);
    expect(result.outputs.should_run).toBeUndefined();
    expect(result.calls).toBe("");
  });

  it("rejects a modified request workflow even with a valid title and write access", () => {
    const result = resolveParameters({ MOCK_REQUEST_BLOB: "modified-blob" });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("must include e2e-request.yml unchanged from main");
    expect(result.outputs.should_run).toBeUndefined();
    expect(result.calls).not.toContain("/pulls/");
  });

  it("keeps ordinary fork PR runs unprivileged even when the approval label exists", () => {
    const result = resolveParameters({ EVENT_NAME: "pull_request" });
    expect(result.status, result.stderr).toBe(0);
    expect(result.outputs.should_run).toBe("false");
    expect(result.outputs.pr_number).toBe("");
    expect(result.calls).toBe("");
    expect(result.summary).toContain("add the run-e2e label");
  });

  it.each([
    ["README.md", "required"],
    ["README.md\nsrc/ci/version.ts", "full"],
  ])("keeps suite selection for same-repository PRs changing %s", (files, suite) => {
    const result = resolveParameters({
      EVENT_NAME: "pull_request",
      PR_HEAD_REPOSITORY: "upstream/setup-vp",
      MOCK_CHANGED_FILES: files,
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.outputs).toMatchObject({
      should_run: "true",
      setup_vp_ref: headSha,
      suite,
      pr_number: "123",
    });
    expect(result.calls).not.toContain("/permission");
  });

  it.each([
    ["push", { EVENT_NAME: "push" }, baseSha, "full", "latest"],
    ["merge queue", { EVENT_NAME: "merge_group" }, baseSha, "full", "latest"],
    ["manual defaults", { EVENT_NAME: "workflow_dispatch" }, baseSha, "full", "latest"],
    [
      "release tag",
      { EVENT_NAME: "push", EVENT_REF: "refs/tags/v1.19.0", EVENT_REF_NAME: "v1.19.0" },
      "v1.19.0",
      "full",
      "latest",
    ],
    [
      "manual overrides",
      {
        EVENT_NAME: "workflow_dispatch",
        MANUAL_SETUP_REF: headSha,
        MANUAL_SUITE: "required",
        MANUAL_VITE_PLUS_VERSION: "0.3.1",
      },
      headSha,
      "required",
      "0.3.1",
    ],
  ])("preserves %s parameters", (_name, env, ref, suite, version) => {
    const result = resolveParameters(env);
    expect(result.status, result.stderr).toBe(0);
    expect(result.outputs).toEqual({
      should_run: "true",
      setup_vp_ref: ref,
      suite,
      vite_plus_version: version,
      pr_number: "",
    });
    expect(result.calls).toBe("");
  });
});
