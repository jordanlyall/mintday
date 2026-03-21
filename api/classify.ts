import type { VercelRequest, VercelResponse } from "@vercel/node";
import { captureError } from "./lib/sentry";

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = "llama-3.3-70b-versatile";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

const SYSTEM_PROMPT = `You are a token type classifier for mint.day. Given a natural language minting request, return JSON with:
- tokenType: one of "Identity", "Attestation", "Credential", "Receipt", "Pass"
- soulbound: boolean
- name: short descriptive name for the token
- extractedFields: object with any additional fields you can extract (addresses, amounts, descriptions)
- missingFields: array of field names that are required but not provided (empty if all present)

Defaults:
- Attestation and Credential are soulbound: true
- Identity, Receipt, and Pass are soulbound: false
- If the user explicitly says "soulbound" or "non-transferable", override the default
- If the user explicitly says "transferable", set soulbound: false

ERC-8004 Identity tokens REQUIRE these fields. Extract them if present, or add to missingFields:
- did: decentralized identifier (e.g. "did:pkh:eip155:8453:0x...")
- capabilities: array of strings describing what the agent can do
- endpoints: array of strings with agent contact URIs (MCP, HTTP, etc.)

Return ONLY valid JSON. No explanation.`;

// Simple in-memory rate limiter: 60 requests per minute per IP
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60 * 1000;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  return true;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  const ip = (req.headers["x-forwarded-for"] as string) || (req.headers["x-real-ip"] as string) || "unknown";
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: "Rate limited. Try again in a minute." });
  }

  if (!GROQ_API_KEY) {
    return res.status(500).json({ error: "Server misconfigured" });
  }

  const { text } = req.body || {};
  if (!text || typeof text !== "string" || text.length > 1000) {
    return res.status(400).json({ error: "text field required (max 1000 chars)" });
  }

  try {
    const response = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `Mint request: "${text}"` },
        ],
        max_tokens: 200,
        temperature: 0,
      }),
    });

    if (!response.ok) {
      return res.status(502).json({ error: "Classification failed" });
    }

    const data = await response.json() as { choices: Array<{ message: { content: string } }> };
    let content = data.choices[0].message.content;

    // Strip markdown code fences if present
    content = content.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();

    // Validate it's valid JSON before passing through
    const parsed = JSON.parse(content);
    return res.status(200).json(parsed);
  } catch (err) {
    captureError(err, { route: "classify" });
    return res.status(500).json({ error: "Classification failed", detail: String(err) });
  }
}
