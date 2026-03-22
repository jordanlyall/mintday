import { createHash } from "crypto";
import { z } from "zod";
import { ethers } from "ethers";
import { TokenType, MintIntent, TokenMetadata, TOKEN_TYPE_NAMES } from "../types.js";
import { classifyIntent } from "../services/classifier.js";
import { CalldataService } from "../services/calldata.js";
import { resolveImage } from "../services/image-upload.js";
import { mintOnRareProtocol } from "../services/rare-protocol.js";

// Intent cache: preview mintId -> frozen intent + platform + options
const intentCache = new Map<string, { intent: MintIntent; platform: string; selfSign: boolean; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function cacheMintId(intent: MintIntent, platform: string = "mintday", selfSign: boolean = false): string {
  const hash = createHash("sha256")
    .update(JSON.stringify(intent))
    .digest("hex")
    .slice(0, 12);
  intentCache.set(hash, { intent, platform, selfSign, expiresAt: Date.now() + CACHE_TTL_MS });
  return hash;
}

function getCachedEntry(mintId: string): { intent: MintIntent; platform: string; selfSign: boolean } | null {
  const entry = intentCache.get(mintId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    intentCache.delete(mintId);
    return null;
  }
  return { intent: entry.intent, platform: entry.platform, selfSign: entry.selfSign };
}

export const mintSchema = {
  description: z
    .string()
    .optional()
    .describe("What to mint, in plain English. Required for new mints, omit when confirming with mintId."),
  tokenType: z
    .enum(["Identity", "Attestation", "Credential", "Receipt", "Pass"])
    .optional()
    .describe("Token type. If provided with soulbound, skips LLM classification."),
  recipient: z
    .string()
    .optional()
    .describe("Ethereum address to receive the token. Required unless DEFAULT_RECIPIENT is set in server config."),
  soulbound: z
    .boolean()
    .optional()
    .describe("Whether the token is non-transferable. Defaults based on token type."),
  image: z
    .string()
    .optional()
    .describe("Image for visual tokens. Accepts: URL, local file path (/path/to/image.png or ~/image.png), or base64 data URI. Local files and base64 are auto-uploaded to Imgur if IMGUR_CLIENT_ID is set."),
  animation_url: z
    .string()
    .optional()
    .describe("Animation URL for rich media tokens (video, audio, HTML, generative art)."),
  mintId: z
    .string()
    .optional()
    .describe("Confirmation ID from a previous preview. Provide this to confirm and get calldata."),
  metadata: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("Additional key-value metadata. Supports strings, arrays, and objects (e.g. capabilities: ['mint'])."),
  selfSign: z
    .boolean()
    .optional()
    .describe("Sign and submit from your own wallet instead of using sponsored gas. Requires PRIVATE_KEY env var or ~/.mint-day/credentials."),
  platform: z
    .enum(["mintday", "superrare"])
    .optional()
    .describe("Which protocol to mint on. 'mintday' uses the MintFactory contract (default). 'superrare' mints via Rare Protocol on Base."),
};

const SPONSOR_URL = process.env.SPONSOR_URL || "https://www.mint.day/api/sponsor";

async function sponsoredMint(result: { to: string; calldata: string; value: string; estimatedGas: number; tokenType: string; soulbound: boolean; chainId: number }, recipient: string): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch(SPONSOR_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: result.to,
        calldata: result.calldata,
        value: result.value,
        estimatedGas: result.estimatedGas,
        recipient,
      }),
    });

    if (!response.ok) {
      const err = await response.json() as { error?: string };
      return { error: err.error || `Sponsored mint failed (${response.status})` };
    }

    const data = await response.json() as { txHash: string; blockNumber: number; gasUsed: string; explorer: string };
    return {
      status: "minted",
      txHash: data.txHash,
      blockNumber: data.blockNumber,
      gasUsed: data.gasUsed,
      tokenType: result.tokenType,
      soulbound: result.soulbound,
      recipient,
      chain: "Base",
      explorer: data.explorer,
      sponsored: true,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: `Sponsor request failed: ${message}` };
  }
}

export async function handleMint(
  params: {
    description?: string;
    tokenType?: string;
    recipient?: string;
    soulbound?: boolean;
    image?: string;
    animation_url?: string;
    mintId?: string;
    metadata?: Record<string, unknown>;
    selfSign?: boolean;
    platform?: string;
  },
  calldataService: CalldataService,
  defaultRecipient: string,
  userKey: string = "",
) {
  // Confirmation path: replay cached intent
  // Check cache first so we can use cached recipient for mode detection
  if (params.mintId) {
    const entry = getCachedEntry(params.mintId);
    if (!entry) {
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ error: "mintId not found or expired. Start a new mint." }, null, 2),
        }],
      };
    }
    const cached = entry.intent;
    const cachedPlatform = entry.platform;
    intentCache.delete(params.mintId);

    const hasRecipient = !!cached.recipient;
    const selfSign = !!entry.selfSign;
    const privateKey = userKey;

    // Rare Protocol path: mint via SuperRare contracts on Base
    if (cachedPlatform === "superrare") {
      if (!privateKey) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: "SuperRare minting requires a private key. Save one to ~/.mint-day/credentials." }, null, 2),
          }],
        };
      }
      try {
        const rareResult = await mintOnRareProtocol(cached, privateKey, false);
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify(rareResult, null, 2),
          }],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: `SuperRare mint failed: ${message}` }, null, 2),
          }],
        };
      }
    }

    const result = await calldataService.buildMintCalldata(cached);

    // Self-sign: user explicitly opted in and has a private key
    if (selfSign && privateKey) {
      try {
        const wallet = new ethers.Wallet(privateKey, calldataService.provider);
        const tx = await wallet.sendTransaction({
          to: result.to,
          data: result.calldata,
          value: BigInt(result.value),
          gasLimit: result.estimatedGas,
        });
        const receipt = await tx.wait();
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              status: "minted",
              txHash: receipt!.hash,
              blockNumber: receipt!.blockNumber,
              gasUsed: receipt!.gasUsed.toString(),
              tokenType: result.tokenType,
              soulbound: result.soulbound,
              recipient: cached.recipient,
              chain: "Base",
              explorer: `https://basescan.org/tx/${receipt!.hash}`,
            }, null, 2),
          }],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: `Transaction failed: ${message}` }, null, 2),
          }],
        };
      }
    }

    if (selfSign && !privateKey) {
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ error: "selfSign requires a private key. Set PRIVATE_KEY env var or save to ~/.mint-day/credentials." }, null, 2),
        }],
      };
    }

    // Default: sponsored gas
    if (hasRecipient) {
      const sponsored = await sponsoredMint(result, cached.recipient);
      if (sponsored && !sponsored.error) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify(sponsored, null, 2),
          }],
        };
      }
      // Sponsored failed: fall through to calldata
      if (sponsored?.error) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              status: "calldata",
              note: `Sponsored gas unavailable: ${sponsored.error}. Use this calldata with your own signer.`,
              to: result.to,
              calldata: result.calldata,
              value: result.value,
              estimatedGas: result.estimatedGas,
              chainId: result.chainId,
              tokenType: result.tokenType,
              soulbound: result.soulbound,
            }, null, 2),
          }],
        };
      }
    }

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          status: "calldata",
          to: result.to,
          calldata: result.calldata,
          value: result.value,
          estimatedGas: result.estimatedGas,
          chainId: result.chainId,
          tokenType: result.tokenType,
          soulbound: result.soulbound,
        }, null, 2),
      }],
    };
  }

  if (!params.description) {
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({ error: "description is required for new mints." }, null, 2),
      }],
    };
  }

  const recipient = params.recipient || defaultRecipient;
  if (!recipient) {
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          status: "setup_required",
          message: "mint.day needs a wallet to sign transactions.",
          options: [
            {
              recommended: true,
              method: "Save a private key to ~/.mint-day/credentials",
              steps: [
                "Generate a wallet: node -e \"console.log(require('ethers').Wallet.createRandom().privateKey)\"",
                "Save it: mkdir -p ~/.mint-day && echo '0xYOUR_KEY' > ~/.mint-day/credentials && chmod 600 ~/.mint-day/credentials",
                "Fund the address with a small amount of ETH on Base (gas is < $0.01 per mint)",
                "Restart the MCP server"
              ]
            },
            {
              method: "Use your own signer (AgentKit, Lit Protocol, etc.)",
              steps: [
                "Pass a recipient address in each mint call",
                "mint.day returns calldata for your signer to submit",
                "Works with Coinbase AgentKit, Lit Protocol, Privy, or any EVM wallet"
              ]
            }
          ]
        }, null, 2),
      }],
    };
  }

  // Validate address
  if (!ethers.isAddress(recipient)) {
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({ error: `Invalid Ethereum address: ${recipient}` }, null, 2),
      }],
    };
  }

  // Resolve image: local files and base64 get uploaded to Imgur (if configured)
  let resolvedImage = params.image;
  let imageUploaded = false;
  if (params.image) {
    try {
      const result = await resolveImage(params.image);
      resolvedImage = result.url;
      imageUploaded = result.uploaded;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ error: `Image resolution failed: ${message}` }, null, 2),
        }],
      };
    }
  }

  let intent: MintIntent;

  if (params.tokenType !== undefined) {
    const typeIndex = TOKEN_TYPE_NAMES.indexOf(params.tokenType as typeof TOKEN_TYPE_NAMES[number]);
    const tokenType: TokenType = typeIndex >= 0 ? typeIndex : TokenType.Attestation;
    const defaultSoulbound = tokenType === TokenType.Attestation || tokenType === TokenType.Credential;

    const meta: Record<string, unknown> = {
      name: params.description,
      description: params.description,
      tokenType: TOKEN_TYPE_NAMES[tokenType],
      soulbound: params.soulbound ?? defaultSoulbound,
      creator: recipient,
      recipient,
      timestamp: new Date().toISOString(),
      chainId: parseInt(process.env.CHAIN_ID || "84532"),
      mintday_version: "1",
      ...(resolvedImage ? { image: resolvedImage } : {}),
      ...(params.animation_url ? { animation_url: params.animation_url } : {}),
      ...(params.metadata || {}),
    };

    // ERC-8004 defaults for Identity tokens
    if (tokenType === TokenType.Identity) {
      if (!meta.did) meta.did = `did:pkh:eip155:${parseInt(process.env.CHAIN_ID || "84532")}:${recipient}`;
      if (!meta.capabilities) meta.capabilities = [];
      if (!meta.endpoints) meta.endpoints = [];
    }

    intent = {
      tokenType,
      soulbound: params.soulbound ?? defaultSoulbound,
      recipient,
      metadata: meta as TokenMetadata,
    };
  } else {
    intent = await classifyIntent(params.description, recipient);
    if (resolvedImage) intent.metadata.image = resolvedImage;
    if (params.animation_url) intent.metadata.animation_url = params.animation_url;
    if (params.metadata) {
      Object.assign(intent.metadata, params.metadata);
    }
  }

  // Cache intent and return preview
  const selectedPlatform = params.platform || "mintday";
  const mintId = cacheMintId(intent, selectedPlatform, !!params.selfSign);

  const preview: Record<string, unknown> = {
    status: "preview",
    mintId,
    platform: selectedPlatform,
    message: `I'll mint a ${TOKEN_TYPE_NAMES[intent.tokenType]} token${intent.soulbound ? " (soulbound)" : ""} to ${intent.recipient} via ${selectedPlatform === "superrare" ? "Rare Protocol (SuperRare)" : "mint.day"}.`,
    tokenType: TOKEN_TYPE_NAMES[intent.tokenType],
    soulbound: intent.soulbound,
    recipient: intent.recipient,
    name: intent.metadata.name,
  };
  if (intent.metadata.image) {
    preview.image = intent.metadata.image;
    if (imageUploaded) preview.imageUploaded = true;
  }
  if (intent.metadata.animation_url) preview.animation_url = intent.metadata.animation_url;
  if (intent.missingFields?.length) {
    preview.missingFields = intent.missingFields;
    preview.hint = "Identity tokens (ERC-8004) should include capabilities[], endpoints[], and did. Provide these in metadata for full compliance.";
  }
  preview.chain = "Base";
  preview.instruction = "Call mint with mintId to confirm.";

  return {
    content: [{ type: "text" as const, text: JSON.stringify(preview, null, 2) }],
  };
}
