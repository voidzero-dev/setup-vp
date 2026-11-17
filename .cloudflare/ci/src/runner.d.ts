// Types for step.runner(). @cloudflare/workers-types does not include it yet.
// The result shape comes from the runtime. The docs show `logs.stdout` and
// `logs.stderr`, but the runtime returns one combined stream in `logs`.
export {};

declare module "cloudflare:workers" {
  interface WorkflowStep {
    runner(name: string, options: RunnerOptions): Promise<RunnerResult>;
    runner(name: string, config: WorkflowStepConfig, options: RunnerOptions): Promise<RunnerResult>;
  }

  /** A saved output of an earlier runner in the same run. */
  type RunnerOutput = object;

  interface RunnerOptions {
    /** A shell script, run with /bin/sh in /workspace as root. */
    command: string;
    inputs?: RunnerOutput[];
    outputs?: Record<string, string>;
    env?: Record<string, string>;
    image?: { repository: string; digest: string };
    instanceSize?: "lite" | "basic" | "standard-1" | "standard-2" | "standard-3" | "standard-4";
    allowFailure?: boolean;
  }

  interface RunnerResult {
    exitCode: number;
    logs: { data: string; truncated: boolean };
    outputs: Record<string, RunnerOutput | null>;
  }
}
