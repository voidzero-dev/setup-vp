import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vite-plus/test";
import { parse as parseYaml } from "yaml";

const workflow = parseYaml(
  readFileSync(new URL("../../.github/workflows/gitlab-e2e.yml", import.meta.url), "utf8"),
);
const report = workflow.jobs["report-result"];
const headSha = "a".repeat(40);
const marker = "<!-- setup-vp-gitlab-e2e -->";
const pipelineUrl = "https://gitlab.com/example/project/-/pipelines/42";

function comment(login = "github-actions[bot]", runId = 100, attempt = 1) {
  return {
    id: 42,
    user: { login },
    body: `${marker}\n<!-- setup-vp-gitlab-e2e-run:${runId}:${attempt} -->\nPrevious result`,
  };
}

function reporter(env: Record<string, string> = {}) {
  const issues = {
    listComments: vi.fn(),
    createComment: vi.fn(),
    updateComment: vi.fn(),
  };
  const github = {
    paginate: vi.fn().mockResolvedValue([]),
    rest: {
      issues,
      pulls: { get: vi.fn().mockResolvedValue({ data: { head: { sha: headSha } } }) },
      repos: {
        getCollaboratorPermissionLevel: vi
          .fn()
          .mockResolvedValue({ data: { permission: "write" } }),
      },
    },
  };
  return {
    github,
    issues,
    run: () =>
      runInNewContext(`(async () => { ${report.steps[0].with.script} })()`, {
        github,
        context: {
          repo: { owner: "upstream", repo: "setup-vp" },
          runId: 200,
          serverUrl: "https://github.com",
        },
        core: { info: vi.fn() },
        process: {
          env: {
            PR_NUMBER: "123",
            SETUP_VP_REF: headSha,
            TEST_SUITE: "full",
            VITE_PLUS_VERSION: "latest",
            PIPELINE_URL: pipelineUrl,
            RESULT: "success",
            GITHUB_RUN_ATTEMPT: "1",
            ...env,
          },
        },
      }),
  };
}

describe("GitLab E2E result comment", () => {
  it("isolates comment writes in an API-only job for validated PRs, including failed runs", () => {
    expect(report.needs).toBe("gitlab-e2e");
    expect(report.if).toBe("always() && needs.gitlab-e2e.outputs.pr_number != ''");
    expect(report.permissions).toEqual({ "pull-requests": "write" });
    expect(report.concurrency).toEqual({
      group: "gitlab-e2e-comment-${{ needs.gitlab-e2e.outputs.pr_number }}",
      "cancel-in-progress": false,
    });
    expect(report.steps).toHaveLength(1);
    expect(report.steps[0].uses).toMatch(/^actions\/github-script@[a-f0-9]{40}$/);
    expect(report.steps[0].with.script).not.toContain("${{");
  });

  it("creates a result with the tested commit and pipeline and run links", async () => {
    const { run, github, issues } = reporter();
    await run();
    expect(github.paginate).toHaveBeenCalledWith(issues.listComments, {
      owner: "upstream",
      repo: "setup-vp",
      issue_number: 123,
      per_page: 100,
    });
    expect(issues.createComment).toHaveBeenCalledOnce();
    const body = issues.createComment.mock.calls[0][0].body;
    expect(body).toContain("### ✅ GitLab E2E passed");
    expect(body).toContain(`Commit: \`${headSha}\``);
    expect(body).toContain("Suite: `full` · Vite+ version: `latest`");
    expect(body).toContain(`[GitLab pipeline](${pipelineUrl})`);
    expect(body).toContain("https://github.com/upstream/setup-vp/actions/runs/200/attempts/1");
    expect(body).toContain("<!-- setup-vp-gitlab-e2e-run:200:1 -->");
    expect(issues.updateComment).not.toHaveBeenCalled();
  });

  it.each(["github-actions[bot]", "maintainer"])(
    "reuses a result posted by %s on a rerun",
    async (login) => {
      const { run, github, issues } = reporter({ GITHUB_RUN_ATTEMPT: "2" });
      github.paginate.mockResolvedValue([comment(login, 200)]);
      await run();
      expect(issues.updateComment).toHaveBeenCalledWith({
        owner: "upstream",
        repo: "setup-vp",
        comment_id: 42,
        body: expect.stringContaining("<!-- setup-vp-gitlab-e2e-run:200:2 -->"),
      });
      expect(issues.createComment).not.toHaveBeenCalled();
      if (login === "maintainer") {
        expect(github.rest.repos.getCollaboratorPermissionLevel).toHaveBeenCalledWith({
          owner: "upstream",
          repo: "setup-vp",
          username: "maintainer",
        });
      } else {
        expect(github.rest.repos.getCollaboratorPermissionLevel).not.toHaveBeenCalled();
      }
    },
  );

  it.each([
    ["failure", pipelineUrl, "❌ GitLab E2E did not complete successfully"],
    ["failure", "", "❌ GitLab E2E could not start"],
    ["cancelled", pipelineUrl, "⚠️ GitLab E2E run cancelled"],
  ])("updates the result for %s with pipeline URL '%s'", async (result, url, title) => {
    const { run, github, issues } = reporter({ RESULT: result, PIPELINE_URL: url });
    github.paginate.mockResolvedValue([comment()]);
    await run();
    const body = issues.updateComment.mock.calls[0][0].body;
    expect(body).toContain(`### ${title}`);
    expect(body.includes("[GitLab pipeline]")).toBe(Boolean(url));
    expect(issues.createComment).not.toHaveBeenCalled();
  });

  it("does not report a result after the PR head changes", async () => {
    const { run, github, issues } = reporter();
    github.rest.pulls.get.mockResolvedValue({ data: { head: { sha: "b".repeat(40) } } });
    await run();
    expect(github.paginate).not.toHaveBeenCalled();
    expect(issues.createComment).not.toHaveBeenCalled();
    expect(issues.updateComment).not.toHaveBeenCalled();
  });

  it.each([
    [201, 1],
    [200, 2],
  ])("does not overwrite a newer run %s attempt %s", async (runId, attempt) => {
    const { run, github, issues } = reporter();
    github.paginate.mockResolvedValue([comment("github-actions[bot]", runId, attempt)]);
    await run();
    expect(issues.createComment).not.toHaveBeenCalled();
    expect(issues.updateComment).not.toHaveBeenCalled();
  });

  it("ignores copied markers from users without write access", async () => {
    const { run, github, issues } = reporter();
    github.paginate.mockResolvedValue([comment("contributor", 999), comment()]);
    github.rest.repos.getCollaboratorPermissionLevel.mockResolvedValue({
      data: { permission: "read" },
    });
    await run();
    expect(issues.updateComment).toHaveBeenCalledOnce();
    expect(issues.createComment).not.toHaveBeenCalled();
  });

  it("fails without creating a duplicate when the comment API is unavailable", async () => {
    const { run, github, issues } = reporter();
    github.paginate.mockRejectedValue(new Error("API unavailable"));
    await expect(run()).rejects.toThrow("API unavailable");
    expect(issues.createComment).not.toHaveBeenCalled();
    expect(issues.updateComment).not.toHaveBeenCalled();
  });
});
