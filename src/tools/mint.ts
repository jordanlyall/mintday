import { createHash } from "crypto";
import { z } from "zod";
import { ethers } from "ethers";
import { TokenType, MintIntent, TokenMetadata, TOKEN_TYPE_NAMES } from "../types.js";
import { classifyIntent } from "../services/classifier.js";
import { CalldataService } from "../services/calldata.js";
import { resolveImage } from "../services/image-upload.js";

// Intent cache: preview mintId -> frozen intent
const intentCache = new Map<string, { intent: MintIntent; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function cacheMintId(intent: MintIntent): string {
  const hash = createHash("sha256")
    .update(JSON.stringify(intent))
    .digest("hex")
    .slice(0, 12);
  intentCache.set(hash, { intent, expiresAt: Date.now() + CACHE_TTL_MS });
  return hash;
}

function getCachedIntent(mintId: string): MintIntent | null {
  const entry = intentCache.get(mintId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    intentCache.delete(mintId);
    return null;
  }
  return entry.intent;
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
};

interface TryitConfig {
  tryitKey: string;
  tryitContract: string;
  tryitRpc: string;
  tryitChain: number;
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
  },
  calldataService: CalldataService,
  defaultRecipient: string,
  userKey: string = "",
  tryit: TryitConfig = { tryitKey: "", tryitContract: "", tryitRpc: "", tryitChain: 84532 },
) {
  // Determine mode:
  // 1. User has private key: mainnet, sign + submit
  // 2. No key but recipient provided: mainnet, return calldata
  // 3. No key, no recipient: testnet try-it mode
  const hasRecipient = !!params.recipient;
  const isTestnet = !userKey && !hasRecipient;
  const privateKey = userKey || (isTestnet ? tryit.tryitKey : "");
  // Confirmation path: replay cached intent
  if (params.mintId) {
    const cached = getCachedIntent(params.mintId);
    if (!cached) {
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ error: "mintId not found or expired. Start a new mint." }, null, 2),
        }],
      };
    }
    intentCache.delete(params.mintId);

    // Use testnet calldataService if in try-it mode
    let activeCalldataService = calldataService;
    if (isTestnet) {
      activeCalldataService = new CalldataService(tryit.tryitRpc, tryit.tryitContract, tryit.tryitChain);
    }
    const result = await activeCalldataService.buildMintCalldata(cached);

    // If we have a private key, sign and submit directly
    if (privateKey) {
      try {
        const provider = isTestnet ? activeCalldataService.provider : calldataService.provider;
        const wallet = new ethers.Wallet(privateKey, provider);
        const tx = await wallet.sendTransaction({
          to: result.to,
          data: result.calldata,
          value: BigInt(result.value),
          gasLimit: result.estimatedGas,
        });
        const receipt = await tx.wait();
        const response: Record<string, unknown> = {
              status: "minted",
              txHash: receipt!.hash,
              blockNumber: receipt!.blockNumber,
              gasUsed: receipt!.gasUsed.toString(),
              tokenType: result.tokenType,
              soulbound: result.soulbound,
              recipient: cached.recipient,
              chain: isTestnet ? "Base Sepolia (testnet)" : "Base",
              explorer: `https://${result.chainId === 8453 ? "" : "sepolia."}basescan.org/tx/${receipt!.hash}`,
            };
        if (isTestnet) {
              response.note = "This token was minted on Base Sepolia (testnet). To mint on Base mainnet, save a private key to ~/.mint-day/credentials and restart the MCP server.";
            }
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify(response, null, 2),
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
  const mintId = cacheMintId(intent);

  const preview: Record<string, unknown> = {
    status: "preview",
    mintId,
    message: `I'll mint a ${TOKEN_TYPE_NAMES[intent.tokenType]} token${intent.soulbound ? " (soulbound)" : ""} to ${intent.recipient}.`,
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
  if (isTestnet) {
    preview.chain = "Base Sepolia (testnet)";
  } else {
    preview.chain = "Base";
  }
  preview.instruction = "Call mint with mintId to confirm.";

  return {
    content: [{ type: "text" as const, text: JSON.stringify(preview, null, 2) }],
  };
}
