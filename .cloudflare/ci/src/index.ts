import {
  WorkflowEntrypoint,
  type RunnerOutput,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { commentOnPullRequest, pullRequestHead, writeCheck } from "./github";

type Params = { sha?: string; mr?: number };

type Job = { name: string; command: string };

type RunContext = { env: Env; step: WorkflowStep; sha: string; runUrl: string };

type RunResult = {
  passed: boolean;
  exitCode: number | null;
  /** Why the job failed, when the exit code does not say it. */
  reason?: string;
  log?: string;
  truncated?: boolean;
  error?: string;
};

type JobResult = { check: string; passed: boolean; reason?: string; checkRunId: number };

type Workspace = { inputs: RunnerOutput[]; installCached: boolean };

// The managed image has Node.js 24, Corepack (pnpm and yarn), git, jq, curl, and build-essential.
const IMAGE = "workflows/node";

// The repository is public, so a runner can fetch any commit by SHA without a
// token, also the head of a fork PR. deps/ gets only the files that the install
// reads, so the install cache stays valid while they do not change.
const CHECKOUT = [
  "git init -q repo && cd repo",
  'git fetch -q --depth 1 "$REMOTE" "$COMMIT"',
  "git checkout -q FETCH_HEAD && git log --oneline -1",
  "mkdir -p ../deps && cp package.json pnpm-lock.yaml pnpm-workspace.yaml ../deps/",
].join(" && ");

// Corepack installs the pnpm version from package.json "packageManager".
// --ignore-scripts skips the root `prepare` script (`vp config`), which sets up
// Git hooks. The install step has only the manifest files, so there is nothing
// to set up. The repository allows no dependency build scripts.
const INSTALL = "cd repo && corepack enable && pnpm install --frozen-lockfile --ignore-scripts";

// Each job runs in repo/ with node_modules restored.
const JOBS: Job[] = [
  {
    // The "build" job in .github/workflows/test.yml.
    name: "build",
    command: [
      "pnpm run typecheck",
      "pnpm run check",
      "pnpm run build",
      `{ git diff --exit-code dist/ || { echo "dist/ is out of date. Run 'vp run build' and commit."; exit 1; }; }`,
    ].join(" && "),
  },
  {
    // The "Unit tests (ubuntu-latest)" job. Some tests read dist/, so build first.
    name: "unit-tests",
    command: ["pnpm run build", "pnpm run test"].join(" && "),
  },
];

// Checkout and install can fail on the network, so retry them.
const SETUP_CONFIG = {
  retries: { limit: 2, delay: "10 seconds", backoff: "exponential" },
  timeout: "10 minutes",
} as const;

// Jobs run once. A step timeout fails the step even with allowFailure, and the
// step loses its logs.
const JOB_CONFIG = { retries: { limit: 0, delay: "1 second" }, timeout: "15 minutes" } as const;

// Stop each job before the step timeout, so that its logs are kept.
// `timeout` exits with 124 when it stops the command.
const COMMAND_TIMEOUT_MINUTES = 14;
const TIMEOUT_EXIT_CODE = 124;

const RUNNER_ENV = {
  CI: "true",
  COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
  NPM_CONFIG_UPDATE_NOTIFIER: "false",
  // Keep ANSI color codes out of the log in the check summary.
  NO_COLOR: "1",
  FORCE_COLOR: "0",
};

// Bumped on each change, because `instances list` does not show which code ran.
const PIPELINE_VERSION = "2026-11-20.1";

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

    const context: RunContext = { env, step, sha, runUrl };
    await Promise.all(JOBS.map(({ name }) => startCheck(context, name)));

    const { results, installCached } = await runJobs(context);
    const passed = results.every((result) => result.passed);

    // Comment only when a check fails. Cloudflare CI cannot update a comment
    // yet, so each comment is a new one.
    if (mr && !passed) {
      await step.do("comment on pull request", () =>
        commentOnPullRequest(env, mr, formatComment(context, mr, results)),
      );
    }

    return {
      conclusion: passed ? "passed" : "failed",
      sha,
      version: PIPELINE_VERSION,
      installCached,
      results,
    };
  }
}

// Checks out the commit, installs the dependencies, and runs the jobs in
// parallel. If the checkout or the install fails, every check fails.
async function runJobs(context: RunContext) {
  let workspace: Workspace;
  try {
    workspace = await prepareWorkspace(context);
  } catch (error) {
    const failure: RunResult = {
      passed: false,
      exitCode: null,
      reason: "checkout or install failed",
      error: errorMessage(error),
    };
    const results = await Promise.all(
      JOBS.map(({ name }) => completeCheck(context, name, failure)),
    );
    return { results, installCached: false };
  }

  const results = await Promise.all(
    JOBS.map(async (job) =>
      completeCheck(context, job.name, await runJob(context.step, job, workspace.inputs)),
    ),
  );
  return { results, installCached: workspace.installCached };
}

async function prepareWorkspace({ env, step, sha }: RunContext): Promise<Workspace> {
  const checkout = await step.runner("checkout", SETUP_CONFIG, {
    image: IMAGE,
    command: CHECKOUT,
    env: { ...RUNNER_ENV, REMOTE: `https://github.com/${env.GITHUB_REPO}.git`, COMMIT: sha },
    outputs: { repo: "repo", deps: "deps" },
  });
  const { repo, deps } = checkout.outputs;
  if (!repo || !deps) throw new Error("The checkout saved no files.");

  // Restore the manifest files in repo/, so that node_modules has the same path
  // here and in the jobs. cache: true skips the install, and starts no
  // container, while the manifest files do not change.
  const install = await step.runner("install", SETUP_CONFIG, {
    image: IMAGE,
    command: INSTALL,
    env: RUNNER_ENV,
    inputs: [{ ...deps, path: "repo" }],
    outputs: { modules: "repo/node_modules" },
    cache: true,
  });
  const { modules } = install.outputs;
  if (!modules) throw new Error("The install saved no node_modules.");

  return { inputs: [repo, modules], installCached: install.cached === true };
}

// Step timeouts and container errors throw, even with allowFailure. Catch them,
// so that the check fails and does not stay in progress.
async function runJob(
  step: WorkflowStep,
  { name, command }: Job,
  inputs: RunnerOutput[],
): Promise<RunResult> {
  try {
    const run = await step.runner(name, JOB_CONFIG, {
      image: IMAGE,
      // JOB_COMMAND keeps the quotes in the job command intact inside `sh -c`.
      command: `timeout ${COMMAND_TIMEOUT_MINUTES}m sh -c "$JOB_COMMAND"`,
      env: { ...RUNNER_ENV, JOB_COMMAND: `cd repo && corepack enable && ${command}` },
      inputs,
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
    return { passed: false, exitCode: null, reason: "runner error", error: errorMessage(error) };
  }
}

function checkName(name: string) {
  return `cloudflare-ci/${name}`;
}

function startCheck({ env, step, sha, runUrl }: RunContext, name: string) {
  return step.do(`start ${name}`, () =>
    writeCheck(env, sha, checkName(name), { status: "in_progress", detailsUrl: runUrl }),
  );
}

async function completeCheck(
  { env, step, sha, runUrl }: RunContext,
  name: string,
  result: RunResult,
): Promise<JobResult> {
  const check = checkName(name);
  const reason = result.passed ? undefined : failureReason(result);
  const { checkRunId } = await step.do(`complete ${name}`, () =>
    writeCheck(env, sha, check, {
      status: "completed",
      conclusion: result.passed ? "success" : "failure",
      title: reason === undefined ? "Passed" : `Failed (${reason})`,
      summary: formatSummary(result),
      detailsUrl: runUrl,
    }),
  );
  return { check, passed: result.passed, reason, checkRunId };
}

function failureReason({ exitCode, reason }: RunResult) {
  if (reason !== undefined) return reason;
  if (exitCode === TIMEOUT_EXIT_CODE) return `timed out after ${COMMAND_TIMEOUT_MINUTES} minutes`;
  return `exit ${exitCode}`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
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
    ({ check, passed, reason, checkRunId }) =>
      `- ${passed ? "✅" : "❌"} [\`${check}\`](${checksUrl}?check_run_id=${checkRunId})` +
      (reason === undefined ? "" : ` (${reason})`),
  );
  return [
    `Cloudflare CI on \`${sha.slice(0, 7)}\`:`,
    ...lines,
    "",
    `[View the run in the Cloudflare dashboard](${runUrl})`,
  ].join("\n");
}

// The Worker serves no HTTP requests. The checkout no longer needs a source server.
export default {
  fetch: () => new Response("Not found", { status: 404 }),
} satisfies ExportedHandler<Env>;
