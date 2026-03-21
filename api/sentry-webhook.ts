import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createHmac } from "crypto";

// Sentry sends webhooks when new issues are created.
// This endpoint validates the signature and dispatches a
// repository_dispatch event to GitHub so the Claude Code Action
// can triage + fix.

const SENTRY_CLIENT_SECRET = process.env.SENTRY_CLIENT_SECRET;
const GITHUB_TOKEN = process.env.GH_DISPATCH_TOKEN;
const GITHUB_REPO = "jordanlyall/mintday";

function verifySentrySignature(
  body: string,
  signature: string | undefined,
  secret: string
): boolean {
  if (!signature) return false;
  const hmac = createHmac("sha256", secret);
  hmac.update(body, "utf8");
  const digest = hmac.digest("hex");
  return signature === digest;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  if (!SENTRY_CLIENT_SECRET || !GITHUB_TOKEN) {
    return res.status(500).json({ error: "Missing env vars" });
  }

  // Verify Sentry webhook signature
  const rawBody = JSON.stringify(req.body);
  const signature = req.headers["sentry-hook-signature"] as string | undefined;

  if (!verifySentrySignature(rawBody, signature, SENTRY_CLIENT_SECRET)) {
    return res.status(401).json({ error: "Invalid signature" });
  }

  const resource = req.headers["sentry-hook-resource"] as string;

  // Only act on new issues (not updates/resolves)
  if (resource !== "issue" || req.body?.action !== "created") {
    return res.status(200).json({ status: "ignored", resource, action: req.body?.action });
  }

  const issue = req.body.data?.issue;
  if (!issue) {
    return res.status(200).json({ status: "no issue data" });
  }

  // Extract useful context for the agent
  const payload = {
    title: issue.title,
    culprit: issue.culprit,
    level: issue.level,
    first_seen: issue.firstSeen,
    count: issue.count,
    url: issue.permalink,
    short_id: issue.shortId,
    metadata: issue.metadata,
    tags: issue.tags?.map((t: { key: string; value: string }) => `${t.key}:${t.value}`),
  };

  // Dispatch to GitHub Actions
  const ghRes = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({
        event_type: "sentry_issue",
        client_payload: payload,
      }),
    }
  );

  if (!ghRes.ok) {
    const err = await ghRes.text();
    console.error("GitHub dispatch failed:", err);
    return res.status(502).json({ error: "GitHub dispatch failed" });
  }

  return res.status(200).json({ status: "dispatched", issue: payload.short_id });
}
