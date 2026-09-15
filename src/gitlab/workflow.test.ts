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
      MANUAL_SETUP_REF: "",
      MANUAL_SUITE: "",
      MANUAL_VITE_PLUS_VERSION: "",
      MOCK_GH_CALLS: calls,
      MOCK_GH_FAILURE: "",
      MOCK_PERMISSION: "write",
      MOCK_REQUEST_BLOB: "trusted-blob",
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
  it("only accepts PR label requests or manual runs and never checks out PR code", () => {
    expect(requestWorkflow.on).toEqual({
      pull_request: { branches: ["main"], types: ["labeled"] },
    });
    expect(requestWorkflow.permissions).toEqual({});
    expect(requestWorkflow.jobs.request.if).toBe("github.event.label.name == 'run-e2e'");
    expect(workflow.on).toEqual({
      workflow_run: {
        workflows: [requestWorkflow.name],
        types: ["completed"],
      },
      workflow_dispatch: {
        inputs: {
          setup_ref: expect.objectContaining({ required: false, default: "" }),
          suite: expect.objectContaining({
            type: "choice",
            options: ["full", "required"],
            default: "full",
          }),
          vite_plus_version: expect.objectContaining({ required: false, default: "latest" }),
        },
      },
    });
    expect(workflow.jobs["gitlab-e2e"].if.replace(/\s+/g, " ")).toBe(
      "github.event_name == 'workflow_dispatch' || " +
        "(github.event_name == 'workflow_run' && " +
        "github.event.workflow_run.event == 'pull_request' && " +
        "github.event.workflow_run.conclusion == 'success' && " +
        "github.event.workflow_run.path == '.github/workflows/e2e-request.yml')",
    );
    expect(requestWorkflow["run-name"]).toBe(
      "PR #${{ github.event.pull_request.number }}: ${{ github.event.action }} ${{ github.event.label.name }} at ${{ github.event.pull_request.head.sha }}",
    );
    expect(workflow.permissions).toEqual({ contents: "read", "pull-requests": "read" });
    expect(steps.every((step) => !step.uses && !step.run.includes("${{"))).toBe(true);
    expect(parameters.env?.REQUEST_HEAD_SHA).toBe("${{ github.event.workflow_run.head_sha }}");
    expect(parameters.env?.REQUEST_ACTOR).toBe("${{ github.event.workflow_run.actor.login }}");
    expect(parameters.env?.MANUAL_SETUP_REF).toBe("${{ inputs.setup_ref }}");
    expect(parameters.env?.MANUAL_SUITE).toBe("${{ inputs.suite }}");
    expect(parameters.env?.MANUAL_VITE_PLUS_VERSION).toBe("${{ inputs.vite_plus_version }}");
    for (const step of steps.slice(1)) {
      expect(step.if).toBe("steps.parameters.outputs.should_run == 'true'");
    }
  });

  it.each([
    ["defaults", {}, baseSha, "full", "latest"],
    [
      "overrides",
      {
        MANUAL_SETUP_REF: headSha,
        MANUAL_SUITE: "required",
        MANUAL_VITE_PLUS_VERSION: "0.3.1",
      },
      headSha,
      "required",
      "0.3.1",
    ],
    ["release tag", { MANUAL_SETUP_REF: "v1.20.0" }, "v1.20.0", "full", "latest"],
  ])("preserves manual run %s", (_name, env, ref, suite, version) => {
    const result = resolveParameters({ EVENT_NAME: "workflow_dispatch", ...env });
    expect(result.status, result.stderr).toBe(0);
    expect(result.outputs).toEqual({
      should_run: "true",
      setup_vp_ref: ref,
      suite,
      vite_plus_version: version,
      pr_number: "",
    });
    expect(result.calls).toBe("");
    expect(result.summary).toBe("");
  });
});

describe.each(["upstream/setup-vp", "contributor/setup-vp"])(
  "GitLab E2E approval from %s",
  (headRepository) => {
    const approvedPr = {
      state: "open",
      head: { sha: headSha, repo: { full_name: headRepository } },
      base: { ref: "main", repo: { full_name: "upstream/setup-vp" } },
      labels: [{ name: "run-e2e" }],
    };

    function resolveRequest(overrides: Record<string, string> = {}): ParameterResult {
      return resolveParameters({
        REQUEST_HEAD_REPOSITORY: headRepository,
        MOCK_PR: JSON.stringify(approvedPr),
        ...overrides,
      });
    }

    it.each(["write", "admin"])(
      "runs the full suite at the event SHA with %s access",
      (permission) => {
        const result = resolveRequest({ MOCK_PERMISSION: permission });
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
      const result = resolveRequest({ MOCK_PERMISSION: permission });
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("requires repository write access");
      expect(result.outputs.should_run).toBeUndefined();
      expect(result.calls).not.toContain("/pulls/");
    });

    it.each(["/permission", "/pulls/", `?ref=${baseSha}`, `?ref=${headSha}`])(
      "fails closed when the %s API request fails",
      (endpoint) => {
        const result = resolveRequest({ MOCK_GH_FAILURE: endpoint });
        expect(result.status).toBe(1);
        expect(result.outputs.should_run).toBeUndefined();
      },
    );

    it.each([
      ["new commit", { head: { ...approvedPr.head, sha: "c".repeat(40) } }],
      [
        "different head repository",
        { head: { ...approvedPr.head, repo: { full_name: "other/setup-vp" } } },
      ],
      ["base change", { base: { ...approvedPr.base, ref: "release" } }],
      [
        "different repository",
        { base: { ...approvedPr.base, repo: { full_name: "other/setup-vp" } } },
      ],
      ["closed PR", { state: "closed" }],
      ["removed label", { labels: [{ name: "other-label" }] }],
      ["missing label", { labels: [] }],
    ])("skips a stale approval after a %s", (_reason, changes) => {
      const result = resolveRequest({ MOCK_PR: JSON.stringify({ ...approvedPr, ...changes }) });
      expect(result.status, result.stderr).toBe(0);
      expect(result.outputs.should_run).toBe("false");
      expect(result.outputs.pr_number).toBe("");
      expect(result.summary).toContain("This approval is stale");
    });

    it.each([
      ["unrelated label", { REQUEST_TITLE: `PR #123: labeled bug at ${headSha}` }],
      ["new push", { REQUEST_TITLE: `PR #123: synchronize run-e2e at ${headSha}` }],
      ["different event", { REQUEST_EVENT: "push" }],
      ["failed request", { REQUEST_CONCLUSION: "failure" }],
      ["different workflow", { REQUEST_PATH: ".github/workflows/fake-request.yml" }],
      ["malformed title", { REQUEST_TITLE: "PR #123: labeled run-e2e at $(exit 1)" }],
    ])("does not approve a privileged run for a %s", (_reason, env) => {
      const result = resolveRequest(env);
      expect(result.status, result.stderr).toBe(0);
      expect(result.outputs.should_run).toBe("false");
      expect(result.outputs.pr_number).toBe("");
      expect(result.calls).toBe("");
    });

    it("rejects a title that claims a different commit than the request run", () => {
      const result = resolveRequest({ REQUEST_TITLE: `PR #123: labeled run-e2e at ${baseSha}` });
      expect(result.status).toBe(1);
      expect(result.outputs.should_run).toBeUndefined();
      expect(result.calls).toBe("");
    });

    it("rejects a modified request workflow even with a valid title and write access", () => {
      const result = resolveRequest({ MOCK_REQUEST_BLOB: "modified-blob" });
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("must include e2e-request.yml unchanged from main");
      expect(result.outputs.should_run).toBeUndefined();
      expect(result.calls).not.toContain("/pulls/");
    });

    it.each(["pull_request", "push", "merge_group"])(
      "skips %s events even when the PR has the approval label",
      (event) => {
        const result = resolveRequest({ EVENT_NAME: event });
        expect(result.status, result.stderr).toBe(0);
        expect(result.outputs.should_run).toBe("false");
        expect(result.outputs.setup_vp_ref).toBe("");
        expect(result.outputs.pr_number).toBe("");
        expect(result.calls).toBe("");
        expect(result.summary).toContain("GitLab E2E requires a successful run-e2e label request");
      },
    );
  },
);
