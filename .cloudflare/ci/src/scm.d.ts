// Copied from the Cloudflare CI "Get started" guide.
// Wrangler does not generate types for the scm binding yet.
// Changes from the docs: RUN_URL_BASE in Env.
interface ScmRepository {
  checkout(target: { sha: string }): Promise<ScmCheckout & Disposable>;
  checkout(target: { mr: number }): Promise<ScmMergeRequestCheckout & Disposable>;
  outbound(): Promise<Fetcher>;
}

interface ScmCheckout {
  readonly checks: {
    write(name: string, update: ScmCheckUpdate): Promise<{ checkRunId: number; url: string }>;
  };
  readFile(file: { path: string }): Promise<string>;
}

interface ScmCheckUpdate {
  status: "queued" | "in_progress" | "completed";
  conclusion?: "success" | "failure" | "neutral" | "cancelled";
  title?: string;
  summary?: string;
  detailsUrl?: string;
}

interface ScmMergeRequestCheckout extends ScmCheckout {
  readonly comments: {
    write(body: string): Promise<{ commentId: number; url: string }>;
  };
}

interface Env {
  REPO: ScmRepository;
  CI_WORKFLOW: Workflow;
  GITHUB_REPO: string;
  SOURCE_ORIGIN: string;
  SOURCE_SECRET: string;
  RUN_URL_BASE: string;
}
