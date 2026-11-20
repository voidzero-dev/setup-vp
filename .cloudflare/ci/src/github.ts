// Based on the helpers in the Cloudflare CI "Get started" guide.
// Changes from the docs: the user-agent, and no source server, because runners
// check out the public repository with git.
const GITHUB_HEADERS = { "user-agent": "setup-vp-ci" };

// Get a new checkout in every step. Checkouts cannot be returned from a step.
export async function writeCheck(env: Env, sha: string, name: string, update: ScmCheckUpdate) {
  const commit = await env.REPO.checkout({ sha });
  try {
    return await commit.checks.write(name, update);
  } finally {
    commit[Symbol.dispose]();
  }
}

export async function commentOnPullRequest(env: Env, mr: number, body: string) {
  const pullRequest = await env.REPO.checkout({ mr });
  try {
    return await pullRequest.comments.write(body);
  } finally {
    pullRequest[Symbol.dispose]();
  }
}

// A pull request checkout does not include its commit SHA, so read it from GitHub.
export async function pullRequestHead(env: Env, mr: number) {
  const outbound = await env.REPO.outbound();
  const response = await outbound.fetch(
    `https://api.github.com/repos/${env.GITHUB_REPO}/commits/refs/pull/${mr}/head`,
    { headers: GITHUB_HEADERS },
  );
  if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
  const { sha } = await response.json<{ sha: string }>();
  return sha;
}
