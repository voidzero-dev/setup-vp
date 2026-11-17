// Copied from the Cloudflare CI "Get started" guide.
// Runners cannot download code from GitHub yet, so this Worker serves it to them.
// Changes from the docs: the user-agent, SHA_PATTERN at module scope (e18e/prefer-static-regex),
// and hasValidSignature() split from serveSource() to keep Fallow complexity below its limit.
const GITHUB_HEADERS = { "user-agent": "setup-vp-ci" };
const SHA_PATTERN = /^[0-9a-f]{40}$/;

// Downloads the commit from SOURCE_URL into ./repo.
export const DOWNLOAD_SOURCE = [
  `node -e 'fetch(process.env.SOURCE_URL).then(async (r) => { if (!r.ok) throw new Error("download failed: " + r.status); require("fs").writeFileSync("source.tgz", Buffer.from(await r.arrayBuffer())); })'`,
  "mkdir repo",
  "tar xzf source.tgz -C repo --strip-components=1",
].join(" && ");

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

export async function sourceUrl(env: Env, sha: string) {
  const expires = Math.floor(Date.now() / 1000) + 15 * 60;
  const signature = await sign(env.SOURCE_SECRET, `${sha}:${expires}`);
  return `${env.SOURCE_ORIGIN}/source/${sha}?expires=${expires}&signature=${signature}`;
}

// Serves one commit's code to a runner, if the URL's signature is valid.
export async function serveSource(request: Request, env: Env) {
  const url = new URL(request.url);
  const [, route, sha = ""] = url.pathname.split("/");

  if (route !== "source" || !SHA_PATTERN.test(sha)) {
    return new Response("Not found", { status: 404 });
  }
  if (!(await hasValidSignature(env, sha, url.searchParams))) {
    return new Response("Forbidden", { status: 403 });
  }

  const outbound = await env.REPO.outbound();
  return outbound.fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/tarball/${sha}`, {
    headers: GITHUB_HEADERS,
  });
}

async function hasValidSignature(env: Env, sha: string, params: URLSearchParams) {
  const expires = Number(params.get("expires"));
  const signature = params.get("signature") ?? "";
  const expected = await sign(env.SOURCE_SECRET, `${sha}:${expires}`);
  const encoder = new TextEncoder();
  return (
    expires > Date.now() / 1000 &&
    signature.length === expected.length &&
    crypto.subtle.timingSafeEqual(encoder.encode(signature), encoder.encode(expected))
  );
}

async function sign(secret: string, message: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}
