import { expect, it } from "vite-plus/test";

// Fails on purpose to show a failed Cloudflare CI check. Do not merge.
it("fails on purpose to show a failed Cloudflare CI check", () => {
  expect({ answer: 1 + 1 }).toEqual({ answer: 3 });
});
