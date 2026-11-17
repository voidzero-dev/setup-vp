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

type RunContext = { env: Env; step: WorkflowStep; sha: string; source: string; runUrl: string };

type RunResult = {
  passed: boolean;
  exitCode: number | null;
  log?: string;
  truncated?: boolean;
  error?: string;
};

type JobResult = { check: string; passed: boolean; exitCode: number | null; checkRunId: number };

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

// Checks run once. A step timeout fails the step even with allowFailure, and
// the step loses its logs.
const RUNNER_CONFIG = { retries: { limit: 0, delay: "1 second" }, timeout: "15 minutes" } as const;

// Stop each command before the step timeout, so that its logs are kept.
// `timeout` exits with 124 when it stops the command.
const COMMAND_TIMEOUT_MINUTES = 14;
const TIMEOUT_EXIT_CODE = 124;

const RUNNER_ENV = {
  CI: "true",
  DEBIAN_FRONTEND: "noninteractive",
  COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
  NPM_CONFIG_UPDATE_NOTIFIER: "false",
  // Keep ANSI color codes out of the log in the check summary.
  NO_COLOR: "1",
  FORCE_COLOR: "0",
};

// Bumped on each change, because `instances list` does not show which code ran.
const PIPELINE_VERSION = "2026-11-17.6";

export class CI extends WorkflowEntrypoint<Env, Params> {
  async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
    const { env } = this;
    const { mr } = event.payload;
    // The checks and the PR comment link to this run in the Cloudflare dashboard.
    const runUrl = env.RUN_URL_BASE + event.instanceId;

    const sha = await step.do("resolve commit", async () => {
      if (event.payload.sha) return event.payload.sha;
      if (!mr) throw new Error("Pass a sha or an mr");
      return pullRequestHead(env, mr);
    });

    const source = await step.do("sign source URL", { sensitive: "output" }, () =>
      sourceUrl(env, sha),
    );

    const context: RunContext = { env, step, sha, source, runUrl };
    const results = await Promise.all(JOBS.map((job) => runJob(context, job)));

    if (mr) {
      await step.do("comment on pull request", () =>
        commentOnPullRequest(env, mr, formatComment(context, mr, results)),
      );
    }

    const passed = results.every((result) => result.passed);
    return { conclusion: passed ? "passed" : "failed", sha, version: PIPELINE_VERSION, results };
  }
}

// Runs one job in a runner and reports it as a GitHub check.
async function runJob(context: RunContext, { name, command }: Job): Promise<JobResult> {
  const { env, step, sha, runUrl } = context;
  const check = `cloudflare-ci/${name}`;
  await step.do(`start ${name}`, () =>
    writeCheck(env, sha, check, { status: "in_progress", detailsUrl: runUrl }),
  );

  const result = await runCommand(step, name, command, context.source);

  const { checkRunId } = await step.do(`complete ${name}`, () =>
    writeCheck(env, sha, check, {
      status: "completed",
      conclusion: result.passed ? "success" : "failure",
      title: result.passed ? "Passed" : `Failed (${failureReason(result.exitCode)})`,
      summary: formatSummary(result),
      detailsUrl: runUrl,
    }),
  );
  return { check, passed: result.passed, exitCode: result.exitCode, checkRunId };
}

// Step timeouts and container errors throw, even with allowFailure. Catch them,
// so that the caller can fail the check and it does not stay in progress.
async function runCommand(
  step: WorkflowStep,
  name: string,
  command: string,
  source: string,
): Promise<RunResult> {
  try {
    const run = await step.runner(name, RUNNER_CONFIG, {
      // JOB_COMMAND keeps the quotes in the job command intact inside `sh -c`.
      command: `timeout ${COMMAND_TIMEOUT_MINUTES}m sh -c "$JOB_COMMAND"`,
      env: { ...RUNNER_ENV, SOURCE_URL: source, JOB_COMMAND: command },
      instanceSize: "standard-3",
      allowFailure: true,
    });
    // The runner returns one combined log stream: { data, truncated }.
    return {
      passed: run.exitCode === 0,
      exitCode: run.exitCode,
      log: run.logs.data,
      truncated: run.logs.truncated,
    };
  } catch (error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return { passed: false, exitCode: null, error: message };
  }
}

function failureReason(exitCode: number | null) {
  if (exitCode === null) return "runner error";
  if (exitCode === TIMEOUT_EXIT_CODE) return `timed out after ${COMMAND_TIMEOUT_MINUTES} minutes`;
  return `exit ${exitCode}`;
}

// The runner keeps at most 16 KiB of log, which fits in a check summary
// (65,535 characters). The four-backtick fence allows ``` in the log.
function formatSummary({ log, truncated, error }: RunResult) {
  if (error !== undefined) return error;
  const heading = truncated ? "The last 16 KiB of the runner log:" : "The runner log:";
  return `${heading}\n\n\`\`\`\`text\n${log ?? ""}\n\`\`\`\``;
}

// Each check name links to its check page on the PR, which shows the runner log.
function formatComment({ env, sha, runUrl }: RunContext, mr: number, results: JobResult[]) {
  const checksUrl = `https://github.com/${env.GITHUB_REPO}/pull/${mr}/checks`;
  const lines = results.map(
    ({ check, passed, exitCode, checkRunId }) =>
      `- ${passed ? "✅" : "❌"} [\`${check}\`](${checksUrl}?check_run_id=${checkRunId})` +
      (passed ? "" : ` (${failureReason(exitCode)})`),
  );
  return [
    `Cloudflare CI on \`${sha.slice(0, 7)}\`:`,
    ...lines,
    "",
    `[View the run in the Cloudflare dashboard](${runUrl})`,
  ].join("\n");
}

export default { fetch: serveSource } satisfies ExportedHandler<Env>;
