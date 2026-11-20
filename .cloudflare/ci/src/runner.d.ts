// Types for step.runner(). @cloudflare/workers-types does not include it yet.
// The result shape comes from the runtime. The docs show `logs.stdout` and
// `logs.stderr`, but the runtime returns one combined stream in `logs`.
export {};

declare module "cloudflare:workers" {
  interface WorkflowStep {
    runner(name: string, options: RunnerOptions): Promise<RunnerResult>;
    runner(name: string, config: WorkflowStepConfig, options: RunnerOptions): Promise<RunnerResult>;
  }

  /**
   * A saved output of a runner. Pass it to `inputs` of a later runner. Change
   * `path` to restore the files somewhere else. Treat the other fields as opaque.
   */
  export interface RunnerOutput {
    /** Where the files are restored, relative to /workspace. */
    path: string;
    /** The SHA-256 of the content. The cache key includes it. */
    hash: string;
  }

  export interface RunnerOptions {
    /** A shell script, run with /bin/sh in /workspace as root. */
    command: string;
    /** A managed image name or an image in the account's registry. */
    image?:
      | "cloudflare/debian-trixie"
      | "workflows/node"
      | "workflows/python"
      | { repository: string; digest: string };
    /** Restored in order. A later input at the same or a parent path replaces earlier ones. */
    inputs?: RunnerOutput[];
    /** Output name to a path to save after the command. */
    outputs?: Record<string, string>;
    /** Not for secrets: values can appear in logs and step output. */
    env?: Record<string, string>;
    instanceSize?: "lite" | "basic" | "standard-1" | "standard-2" | "standard-3" | "standard-4";
    allowFailure?: boolean;
    /**
     * Reuse the result of an earlier run with the same image, command, env,
     * outputs, allowFailure, and input hashes and paths. Results are kept for
     * 7 days. Allowed failures are cached too.
     */
    cache?: boolean | { key?: string };
  }

  export interface RunnerResult {
    exitCode: number;
    /** The last 16 KiB of stdout and stderr, combined in order. */
    logs: { data: string; truncated: boolean };
    /** `null` when the path did not exist after an allowed failure. */
    outputs: Record<string, RunnerOutput | null>;
    /** Set when the result came from the cache and no container ran. */
    cached?: true;
  }
}
