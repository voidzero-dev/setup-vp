import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vite-plus/test";
import { parse as parseYaml } from "yaml";

const build = parseYaml(
  readFileSync(new URL("../.github/workflows/rebuild-bundle.yml", import.meta.url), "utf8"),
);
const publisher = parseYaml(
  readFileSync(new URL("../.github/workflows/publish-bundle.yml", import.meta.url), "utf8"),
);
const validation = publisher.jobs.publish.steps[0];
const head = "a".repeat(40);
const trustedSha = "b".repeat(40);

function fixture() {
  const context = {
    repo: { owner: "upstream", repo: "setup-vp" },
    sha: trustedSha,
    payload: {
      repository: { default_branch: "main" },
      workflow_run: {
        id: 42,
        event: "pull_request",
        conclusion: "success",
        path: ".github/workflows/rebuild-bundle.yml",
        head_repository: { full_name: "upstream/setup-vp" },
        head_branch: "renovate/vite-plus",
        head_sha: head,
        display_title: `Rebuild PR #123 at ${head}`,
      },
    },
  };
  const pr = {
    number: 123,
    state: "open",
    head: { sha: head, ref: "renovate/vite-plus", repo: { full_name: "upstream/setup-vp" } },
    base: { ref: "main", repo: { full_name: "upstream/setup-vp" } },
    labels: [{ name: "needs-bundle-rebuild" }],
  };
  const github = {
    rest: {
      repos: {
        getContent: vi.fn().mockResolvedValue({ data: { type: "file", sha: "workflow-blob" } }),
      },
      pulls: { get: vi.fn().mockResolvedValue({ data: pr }) },
    },
  };
  const outputs: Record<string, string | number> = {};
  const core = {
    info: vi.fn(),
    setOutput: (name: string, value: string | number) => {
      outputs[name] = value;
    },
  };
  const execute = (step: { with: { script: string } }): Promise<void> =>
    runInNewContext(`(async () => {\n${step.with.script}\n})()`, { github, context, core });
  return { context, pr, github, outputs, execute };
}

it("identifies the PR and exact build commit in the run name", () => {
  expect(build["run-name"]).toBe(
    "Rebuild PR #${{ github.event.pull_request.number }} at ${{ github.event.pull_request.head.sha }}",
  );
  expect(validation.id).toBe("request");
  const prepare = publisher.jobs.publish.steps.find(
    (step: { id?: string }) => step.id === "prepare",
  );
  expect(prepare.env).toEqual({
    PR_NUMBER: "${{ steps.request.outputs.pr-number }}",
    PR_BRANCH: "${{ steps.request.outputs.branch }}",
  });
});

describe("bundle build provenance", () => {
  it("accepts a labeled PR only after checking its workflow and current head", async () => {
    const f = fixture();
    await f.execute(validation);
    expect(f.outputs).toEqual({ "pr-number": 123, branch: "renovate/vite-plus", ready: "true" });
    expect(f.github.rest.repos.getContent).toHaveBeenNthCalledWith(1, {
      ...f.context.repo,
      path: ".github/workflows/rebuild-bundle.yml",
      ref: trustedSha,
    });
    expect(f.github.rest.repos.getContent).toHaveBeenNthCalledWith(2, {
      ...f.context.repo,
      path: ".github/workflows/rebuild-bundle.yml",
      ref: head,
    });
    expect(f.github.rest.pulls.get).toHaveBeenCalledWith({ ...f.context.repo, pull_number: 123 });
  });

  it.each([
    { event: "push" },
    { conclusion: "failure" },
    { path: ".github/workflows/impostor.yml" },
    { head_repository: { full_name: "fork/setup-vp" } },
  ])("ignores an ineligible run: %j", async (changes) => {
    const f = fixture();
    Object.assign(f.context.payload.workflow_run, changes);
    await f.execute(validation);
    expect(f.outputs).toEqual({});
    expect(f.github.rest.repos.getContent).not.toHaveBeenCalled();
  });

  it.each(["Rebuild PR #123 at $(exit 1)", `Rebuild PR #123 at ${trustedSha}`])(
    "rejects a malformed or mismatched run title: %s",
    async (title) => {
      const f = fixture();
      f.context.payload.workflow_run.display_title = title;
      await expect(f.execute(validation)).rejects.toThrow("run head SHA");
      expect(f.outputs).toEqual({});
    },
  );

  it("rejects a PR that modifies the build workflow", async () => {
    const f = fixture();
    f.github.rest.repos.getContent.mockResolvedValueOnce({
      data: { type: "file", sha: "trusted" },
    });
    await expect(f.execute(validation)).rejects.toThrow("must match the default branch");
    expect(f.outputs).toEqual({});
    expect(f.github.rest.pulls.get).not.toHaveBeenCalled();
  });

  it.each(["workflow", "pull request"])("fails closed if the %s API fails", async (target) => {
    const f = fixture();
    const request =
      target === "workflow" ? f.github.rest.repos.getContent : f.github.rest.pulls.get;
    request.mockRejectedValue(new Error("API failure"));
    await expect(f.execute(validation)).rejects.toThrow("API failure");
    expect(f.outputs).toEqual({});
  });

  it.each(["commit", "fork", "base repository", "branch", "default branch", "closed", "label"])(
    "skips after a change to the PR's %s",
    async (change) => {
      const f = fixture();
      if (change === "commit") f.pr.head.sha = trustedSha;
      if (change === "fork") f.pr.head.repo.full_name = "fork/setup-vp";
      if (change === "base repository") f.pr.base.repo.full_name = "other/setup-vp";
      if (change === "branch") f.pr.head.ref = "other-branch";
      if (change === "default branch") {
        f.pr.head.ref = "main";
        f.pr.base.ref = "release";
        f.context.payload.workflow_run.head_branch = "main";
      }
      if (change === "closed") f.pr.state = "closed";
      if (change === "label") f.pr.labels = [];
      await f.execute(validation);
      expect(f.outputs).toEqual({});
    },
  );
});
