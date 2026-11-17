import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import {
  DOWNLOAD_SOURCE,
  commentOnPullRequest,
  pullRequestHead,
  serveSource,
  sourceUrl,
  writeCheck,
} from "./github";

type Params = { sha?: string; mr?: number };

type Job = { name: string; command: string };

type RunResult = { passed: boolean; exitCode: number | null; summary?: string };

type JobResult = { check: string; passed: boolean; exitCode: number | null };

// The default image has Node.js 24, npm, and Corepack, but no pnpm or git.
// Corepack installs the pnpm version from package.json "packageManager".
// --ignore-scripts skips the root `prepare` script (`vp config`), which sets up
// Git hooks and fails without a git binary. The repo allows no dependency
// build scripts, so nothing else is skipped.
const INSTALL = [
  DOWNLOAD_SOURCE,
  "cd repo",
  "{ command -v corepack > /dev/null || npm install -g corepack; }",
  "corepack enable",
  "pnpm install --frozen-lockfile --ignore-scripts",
].join(" && ");

const JOBS: Job[] = [
  {
    // The "build" job in .github/workflows/test.yml. Runners get no Git
    // history, so compare dist/ with a copy instead of `git diff`.
    name: "build",
    command: [
      INSTALL,
      "pnpm run typecheck",
      "pnpm run check",
      "cp -R dist /tmp/dist-before",
      "pnpm run build",
      `{ diff -rq /tmp/dist-before dist || { echo "dist/ is out of date. Run 'vp run build' and commit."; exit 1; }; }`,
    ].join(" && "),
  },
  {
    // The "Unit tests (ubuntu-latest)" job. Some tests read dist/, so build first.
    // src/gitlab/workflow.test.ts runs the gitlab-e2e.yml script, which needs jq.
    // GitHub-hosted runners include jq, but the default image does not.
    name: "unit-tests",
    command: [
      "apt-get update -qq",
      "apt-get install -y -qq jq > /dev/null",
      INSTALL,
      "pnpm run build",
      "pnpm run test",
    ].join(" && "),
  },
];

// Checks run once. A timeout fails the step even with allowFailure.
const RUNNER_CONFIG = { retries: { limit: 0, delay: "1 second" }, timeout: "15 minutes" } as const;

const RUNNER_ENV = {
  CI: "true",
  DEBIAN_FRONTEND: "noninteractive",
  COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
  NPM_CONFIG_UPDATE_NOTIFIER: "false",
};

// Bumped on each change, because `instances list` does not show which code ran.
const PIPELINE_VERSION = "2026-11-17.4";

export class CI extends WorkflowEntrypoint<Env, Params> {
  async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
    const { env } = this;
    const { mr } = event.payload;

    const sha = await step.do("resolve commit", async () => {
      if (event.payload.sha) return event.payload.sha;
      if (!mr) throw new Error("Pass a sha or an mr");
      return pullRequestHead(env, mr);
    });

    const source = await step.do("sign source URL", { sensitive: "output" }, () =>
      sourceUrl(env, sha),
    );

    const results = await Promise.all(JOBS.map((job) => runJob(env, step, sha, source, job)));

    if (mr) {
      await step.do("comment on pull request", () =>
        commentOnPullRequest(env, mr, formatComment(sha, results)),
      );
    }

    const passed = results.every((result) => result.passed);
    return { conclusion: passed ? "passed" : "failed", sha, version: PIPELINE_VERSION, results };
  }
}

// Runs one job in a runner and reports it as a GitHub check.
async function runJob(
  env: Env,
  step: WorkflowStep,
  sha: string,
  source: string,
  { name, command }: Job,
): Promise<JobResult> {
  const check = `cloudflare-ci/${name}`;
  await step.do(`start ${name}`, () => writeCheck(env, sha, check, { status: "in_progress" }));

  const result = await runCommand(step, name, command, source);

  await step.do(`complete ${name}`, () =>
    writeCheck(env, sha, check, {
      status: "completed",
      conclusion: result.passed ? "success" : "failure",
      title: result.passed ? "Passed" : `Failed (${failureReason(result.exitCode)})`,
      summary: result.summary,
    }),
  );
  return { check, passed: result.passed, exitCode: result.exitCode };
}

// Timeouts and container errors throw, even with allowFailure. Catch them, so
// that the caller can fail the check and it does not stay in progress.
async function runCommand(
  step: WorkflowStep,
  name: string,
  command: string,
  source: string,
): Promise<RunResult> {
  try {
    const run = await step.runner(name, RUNNER_CONFIG, {
      command,
      env: { ...RUNNER_ENV, SOURCE_URL: source },
      instanceSize: "standard-3",
      allowFailure: true,
    });
    if (run.exitCode === 0) return { passed: true, exitCode: 0 };
    // The runner returns one combined log stream: { data, truncated }.
    return {
      passed: false,
      exitCode: run.exitCode,
      summary: "```\n" + run.logs.data.slice(-6000) + "\n```",
    };
  } catch (error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return { passed: false, exitCode: null, summary: message };
  }
}

function failureReason(exitCode: number | null) {
  return exitCode === null ? "runner error" : `exit ${exitCode}`;
}

function formatComment(sha: string, results: JobResult[]) {
  const lines = results.map(
    ({ check, passed, exitCode }) =>
      `- ${passed ? "✅" : "❌"} \`${check}\`` + (passed ? "" : ` (${failureReason(exitCode)})`),
  );
  return [`Cloudflare CI on \`${sha.slice(0, 7)}\`:`, ...lines].join("\n");
}

export default { fetch: serveSource } satisfies ExportedHandler<Env>;
