import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { parse as parseYaml } from "yaml";

interface Step {
  id?: string;
  uses?: string;
  if?: string;
  run?: string;
  with?: Record<string, string | boolean | number>;
}

const workflow = parseYaml(
  readFileSync(new URL("../.github/workflows/rebuild-bundle.yml", import.meta.url), "utf8"),
);
const publisher = parseYaml(
  readFileSync(new URL("../.github/workflows/publish-bundle.yml", import.meta.url), "utf8"),
);
const buildSteps = workflow.jobs.rebuild.steps as Step[];
const commitSteps = publisher.jobs.publish.steps as Step[];
const prepareStep = commitSteps.find((step) => step.id === "prepare")!;
const publishStep = commitSteps.at(-1)!;
const bundleFiles = ["index.mjs", "gitlab/index.mjs", "azure/index.mjs"];
const headSha = "a".repeat(40);
const tempDirs: string[] = [];
const require = createRequire(import.meta.url);

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function blobSha(content: string): string {
  return createHash("sha1")
    .update(`blob ${Buffer.byteLength(content)}\0`)
    .update(content)
    .digest("hex");
}

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "setup-vp-rebuild-"));
  tempDirs.push(dir);
  const root = join(dir, "rebuilt-bundles");
  const inputPath = join(dir, "bundle-commit.json");
  for (const file of bundleFiles) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), `throw new Error('Do not execute ${file}');\n`);
  }
  const pr = {
    number: 123,
    state: "open",
    head: { sha: headSha, ref: "renovate/dependencies", repo: { full_name: "upstream/setup-vp" } },
    labels: [{ name: "needs-bundle-rebuild" }],
  };
  const context = {
    repo: { owner: "upstream", repo: "setup-vp" },
    payload: { workflow_run: { head_sha: headSha, head_branch: pr.head.ref } },
  };
  const tree = {
    truncated: false,
    tree: bundleFiles.map((file) => ({
      path: `dist/${file}`,
      mode: "100644",
      type: "blob",
      sha: blobSha("old bundle"),
    })),
  };
  const github = {
    rest: {
      pulls: { get: vi.fn().mockResolvedValue({ data: pr }) },
      git: {
        getCommit: vi.fn().mockResolvedValue({ data: { tree: { sha: "base-tree" } } }),
        getTree: vi.fn().mockResolvedValue({ data: tree }),
      },
    },
    graphql: vi.fn().mockResolvedValue({ createCommitOnBranch: { commit: { oid: "new-commit" } } }),
  };
  const core = { info: vi.fn(), setOutput: vi.fn() };
  function run(step: Step): Promise<void> {
    return runInNewContext(`(async () => { ${step.with!.script} })()`, {
      require,
      github,
      context,
      core,
      process: {
        env: {
          RUNNER_TEMP: dir,
          PR_NUMBER: String(pr.number),
          PR_BRANCH: context.payload.workflow_run.head_branch,
        },
      },
    });
  }
  return {
    root,
    inputPath,
    pr,
    tree,
    context,
    github,
    core,
    prepare: () => run(prepareStep),
    publish: () => run(publishStep),
    input: () => JSON.parse(readFileSync(inputPath, "utf8")),
  };
}

describe("bundle rebuild credential isolation", () => {
  it("runs PR builds without secrets or persisted credentials at the event SHA", () => {
    expect(workflow.on).toEqual({ pull_request: { types: ["labeled", "synchronize"] } });
    expect(workflow.permissions).toEqual({});
    expect(workflow.jobs.rebuild.permissions).toEqual({ contents: "read" });
    expect(workflow.jobs.rebuild.if).toContain("'needs-bundle-rebuild'");
    expect(workflow.jobs.rebuild.if).toContain(
      "github.event.pull_request.head.repo.full_name == github.repository",
    );
    const checkout = buildSteps.find((step) => step.uses?.startsWith("actions/checkout@"))!;
    expect(checkout.with).toEqual({
      ref: "${{ github.event.pull_request.head.sha }}",
      "persist-credentials": false,
    });
    expect(JSON.stringify(workflow.jobs.rebuild)).not.toMatch(
      /secrets\.|app-token|contents.*write/,
    );
    const upload = buildSteps.at(-1)!;
    expect(upload.uses).toMatch(/^actions\/upload-artifact@[a-f0-9]{40}$/);
    expect(String(upload.with!.path).trim().split("\n").sort()).toEqual(
      bundleFiles.map((file) => `dist/${file}`).sort(),
    );
    expect(upload.with!["if-no-files-found"]).toBe("error");
  });

  it("creates a contents-only App token after validation in a default-branch workflow", () => {
    expect(publisher.on).toEqual({
      workflow_run: { workflows: [workflow.name], types: ["completed"] },
    });
    expect(publisher.permissions).toEqual({});
    expect(publisher.jobs.publish.permissions).toEqual({
      actions: "read",
      contents: "read",
      "pull-requests": "read",
    });
    expect(commitSteps.map((step) => step.uses?.split("@")[0])).toEqual([
      "actions/github-script",
      "actions/download-artifact",
      "actions/github-script",
      "actions/create-github-app-token",
      "actions/github-script",
    ]);
    expect(commitSteps.every((step) => !step.run && /@[a-f0-9]{40}$/.test(step.uses!))).toBe(true);
    expect(commitSteps[1].with).toEqual({
      name: "rebuilt-bundles-${{ github.event.workflow_run.run_attempt }}",
      path: "${{ runner.temp }}/rebuilt-bundles",
      "github-token": "${{ github.token }}",
      "run-id": "${{ github.event.workflow_run.id }}",
    });
    expect(buildSteps.at(-1)!.with!.name).toBe("rebuilt-bundles-${{ github.run_attempt }}");
    expect(commitSteps[3].with).toEqual({
      "client-id": "${{ secrets.APP_ID }}",
      "private-key": "${{ secrets.APP_PRIVATE_KEY }}",
      repositories: "${{ github.event.repository.name }}",
      "permission-contents": "write",
    });
    for (const step of commitSteps.slice(1, 3)) {
      expect(step.if).toBe("steps.request.outputs.ready == 'true'");
    }
    for (const step of commitSteps.slice(3)) {
      expect(step.if).toBe("steps.prepare.outputs.changed == 'true'");
    }
    expect(publishStep.with!["github-token"]).toBe("${{ steps.app-token.outputs.token }}");
    expect(prepareStep.with!["github-token"]).toBeUndefined();
  });
});

describe("bundle artifact validation and commit", () => {
  it("commits only bundle data to the event branch with an atomic head check", async () => {
    const f = fixture();
    await f.prepare();
    expect(f.core.setOutput).toHaveBeenCalledWith("changed", "true");
    const input = f.input();
    expect(input).toEqual({
      branch: {
        repositoryNameWithOwner: "upstream/setup-vp",
        refName: "refs/heads/renovate/dependencies",
      },
      expectedHeadOid: headSha,
      message: { headline: "chore: rebuild action bundle for dependency update" },
      fileChanges: {
        additions: bundleFiles.map((file) => ({
          path: `dist/${file}`,
          contents: readFileSync(join(f.root, file)).toString("base64"),
        })),
      },
    });
    expect(f.github.rest.git.getCommit).toHaveBeenCalledWith({
      ...f.context.repo,
      commit_sha: headSha,
    });
    expect(f.github.rest.git.getTree).toHaveBeenCalledWith({
      ...f.context.repo,
      tree_sha: "base-tree",
      recursive: "true",
    });
    await f.publish();
    expect(f.github.graphql).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining("createCommitOnBranch(input: $input)"),
      { input },
    );
  });

  it("skips unchanged bundles so the follow-up run cannot create a commit loop", async () => {
    const f = fixture();
    for (const entry of f.tree.tree) {
      entry.sha = blobSha(readFileSync(join(f.root, entry.path.slice(5)), "utf8"));
    }
    await f.prepare();
    expect(f.core.info).toHaveBeenCalledWith("Bundle already up to date; nothing to push.");
    expect(f.core.setOutput).not.toHaveBeenCalled();
    expect(existsSync(f.inputPath)).toBe(false);
  });

  it("includes only changed or missing files", async () => {
    const f = fixture();
    f.tree.tree[0].sha = blobSha(readFileSync(join(f.root, "index.mjs"), "utf8"));
    f.tree.tree.pop();
    await f.prepare();
    expect(f.input().fileChanges.additions.map((entry: { path: string }) => entry.path)).toEqual([
      "dist/gitlab/index.mjs",
      "dist/azure/index.mjs",
    ]);
  });

  it.each(["sha", "branch", "repository", "closed", "label"])(
    "skips a PR after its %s changes",
    async (change) => {
      const f = fixture();
      if (change === "sha") f.pr.head.sha = "b".repeat(40);
      if (change === "branch") f.pr.head.ref = "other-branch";
      if (change === "repository") f.pr.head.repo.full_name = "fork/setup-vp";
      if (change === "closed") f.pr.state = "closed";
      if (change === "label") f.pr.labels = [];
      await f.prepare();
      expect(f.core.setOutput).not.toHaveBeenCalled();
      expect(f.github.rest.git.getCommit).not.toHaveBeenCalled();
      expect(existsSync(f.inputPath)).toBe(false);
    },
  );

  it.each([".git/config", "package.json", "azure/unexpected.mjs", "gitlab/hooks/pre-commit"])(
    "rejects the unexpected artifact path %s",
    async (file) => {
      const f = fixture();
      mkdirSync(dirname(join(f.root, file)), { recursive: true });
      writeFileSync(join(f.root, file), "untrusted data");
      await expect(f.prepare()).rejects.toThrow("Unexpected bundle artifact entry");
      expect(f.core.setOutput).not.toHaveBeenCalled();
      expect(existsSync(f.inputPath)).toBe(false);
    },
  );

  it.skipIf(process.platform === "win32").each(["index.mjs", "gitlab"])(
    "rejects a symlink at %s",
    async (file) => {
      const f = fixture();
      rmSync(join(f.root, file), { recursive: true });
      symlinkSync(f.inputPath, join(f.root, file));
      await expect(f.prepare()).rejects.toThrow("Unexpected bundle artifact entry");
      expect(f.core.setOutput).not.toHaveBeenCalled();
    },
  );

  it.each(["missing", "empty", "oversized"])("rejects a %s bundle", async (kind) => {
    const f = fixture();
    const bundle = join(f.root, "index.mjs");
    if (kind === "missing") rmSync(bundle);
    else truncateSync(bundle, kind === "empty" ? 0 : 10 * 1024 * 1024 + 1);
    await expect(f.prepare()).rejects.toThrow();
    expect(f.core.setOutput).not.toHaveBeenCalled();
    expect(existsSync(f.inputPath)).toBe(false);
  });

  it("rejects a truncated Git tree", async () => {
    const f = fixture();
    f.tree.truncated = true;
    await expect(f.prepare()).rejects.toThrow("truncated repository tree");
    expect(f.core.setOutput).not.toHaveBeenCalled();
  });

  it.each(["120000", "160000", "040000", "100755"])(
    "rejects an existing bundle with Git mode %s",
    async (mode) => {
      const f = fixture();
      f.tree.tree[0].mode = mode;
      await expect(f.prepare()).rejects.toThrow("Expected a regular repository file");
      expect(f.core.setOutput).not.toHaveBeenCalled();
    },
  );

  it("keeps shell syntax in branch names and bundle contents as data", async () => {
    const f = fixture();
    const branch = "renovate/$(echo-injected)";
    f.pr.head.ref = branch;
    f.context.payload.workflow_run.head_branch = branch;
    const content = "`${process.env.APP_TOKEN}`\n$(echo injected)\n\u0000\u00e9";
    writeFileSync(join(f.root, "index.mjs"), content);
    await f.prepare();
    expect(f.input().branch.refName).toBe(`refs/heads/${branch}`);
    expect(Buffer.from(f.input().fileChanges.additions[0].contents, "base64").toString()).toBe(
      content,
    );
    await f.publish();
    expect(f.github.graphql).toHaveBeenCalledOnce();
  });

  it.each(["pull", "commit", "tree"])("fails closed on a %s API error", async (api) => {
    const f = fixture();
    const method =
      api === "pull"
        ? f.github.rest.pulls.get
        : api === "commit"
          ? f.github.rest.git.getCommit
          : f.github.rest.git.getTree;
    method.mockRejectedValue(new Error("API unavailable"));
    await expect(f.prepare()).rejects.toThrow("API unavailable");
    expect(f.core.setOutput).not.toHaveBeenCalled();
    expect(existsSync(f.inputPath)).toBe(false);
  });

  it("does not retry a rejected commit against a newer branch head", async () => {
    const f = fixture();
    await f.prepare();
    f.github.graphql.mockRejectedValue(new Error("expectedHeadOid does not match"));
    await expect(f.publish()).rejects.toThrow("expectedHeadOid does not match");
    expect(f.github.graphql).toHaveBeenCalledOnce();
    expect(f.input().expectedHeadOid).toBe(headSha);
  });
});
