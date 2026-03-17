import { TokenType, MintIntent, TOKEN_TYPE_NAMES } from "../types.js";

const CLASSIFY_URL = process.env.CLASSIFY_URL || "https://agent-mint-nine.vercel.app/api/classify";

function extractAddress(text: string): string | null {
  const match = text.match(/0x[a-fA-F0-9]{40}/);
  return match ? match[0] : null;
}

async function classify(text: string): Promise<Record<string, unknown>> {
  const response = await fetch(CLASSIFY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    throw new Error(`Classify API error: ${response.status}`);
  }

  return await response.json() as Record<string, unknown>;
}

export async function classifyIntent(
  text: string,
  fallbackRecipient: string,
): Promise<MintIntent> {
  let parsed: Record<string, unknown>;
  try {
    parsed = await classify(text);
  } catch {
    // If API fails, use keyword fallback
    parsed = keywordFallback(text);
  }

  const typeName = String(parsed.tokenType || "Attestation");
  const typeIndex = TOKEN_TYPE_NAMES.indexOf(typeName as typeof TOKEN_TYPE_NAMES[number]);
  const tokenType: TokenType = typeIndex >= 0 ? typeIndex : TokenType.Attestation;
  const soulbound = (parsed.soulbound as boolean | undefined) ?? (tokenType === TokenType.Attestation || tokenType === TokenType.Credential);
  const name = String(parsed.name || "mint.day token");
  const recipient = extractAddress(text) || fallbackRecipient;

  const extractedFields = (parsed.extractedFields as Record<string, unknown>) || {};
  const missingFields = (parsed.missingFields as string[]) || [];

  // For Identity tokens, auto-generate did if missing
  if (tokenType === TokenType.Identity && !extractedFields.did) {
    extractedFields.did = `did:pkh:eip155:${parseInt(process.env.CHAIN_ID || "8453")}:${recipient}`;
  }

  // Default empty arrays for Identity ERC-8004 fields
  if (tokenType === TokenType.Identity) {
    if (!extractedFields.capabilities) extractedFields.capabilities = [];
    if (!extractedFields.endpoints) extractedFields.endpoints = [];
  }

  return {
    tokenType,
    soulbound,
    recipient,
    missingFields: tokenType === TokenType.Identity ? missingFields.filter(
      (f) => f !== "did" && !(extractedFields[f] as unknown[] | undefined)?.length
    ) : [],
    metadata: {
      name,
      description: text,
      tokenType: TOKEN_TYPE_NAMES[tokenType],
      soulbound,
      creator: fallbackRecipient,
      recipient,
      timestamp: new Date().toISOString(),
      chainId: parseInt(process.env.CHAIN_ID || "8453"),
      mintday_version: "1",
      ...extractedFields,
    },
  };
}

function keywordFallback(text: string): Record<string, unknown> {
  const lower = text.toLowerCase();

  if (/identity|who i am|register|agent card/.test(lower)) {
    return { tokenType: "Identity", soulbound: false, name: "mint.day token", extractedFields: {}, missingFields: [] };
  }
  if (/credential|vetted|reputation|certified|qualified/.test(lower)) {
    return { tokenType: "Credential", soulbound: true, name: "mint.day token", extractedFields: {}, missingFields: [] };
  }
  if (/receipt|payment|settled|paid|invoice/.test(lower)) {
    return { tokenType: "Receipt", soulbound: false, name: "mint.day token", extractedFields: {}, missingFields: [] };
  }
  if (/pass|access|api|grant|permission|key/.test(lower)) {
    return { tokenType: "Pass", soulbound: false, name: "mint.day token", extractedFields: {}, missingFields: [] };
  }
  // Default: Attestation (proof of action)
  return { tokenType: "Attestation", soulbound: true, name: "mint.day token", extractedFields: {}, missingFields: [] };
}
