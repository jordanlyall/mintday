import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { createRareClient } from "@rareprotocol/rare-cli/client";
import { encodeMetadata } from "./metadata.js";
import { MintIntent, TOKEN_TYPE_NAMES } from "../types.js";

// Default mint.day collection on Rare Protocol (Base mainnet)
// Set via RARE_CONTRACT env var, or deploy one with scripts/deploy-rare-collection.ts
const DEFAULT_RARE_CONTRACT = process.env.RARE_CONTRACT || "";

export interface RareMintResult {
  status: string;
  txHash: string;
  tokenId: string;
  contract: string;
  platform: string;
  tokenType: string;
  soulbound: boolean;
  recipient: string;
  chain: string;
  explorer: string;
  tokenUri: string;
}

export async function mintOnRareProtocol(
  intent: MintIntent,
  privateKey: string,
): Promise<RareMintResult> {
  const chain = base;
  const contractAddress = DEFAULT_RARE_CONTRACT as `0x${string}`;

  if (!contractAddress) {
    throw new Error(
      "RARE_CONTRACT not set. Deploy a collection first: node scripts/deploy-rare-collection.mjs",
    );
  }

  const account = privateKeyToAccount(privateKey as `0x${string}`);

  const publicClient = createPublicClient({
    chain,
    transport: http(),
  });

  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(),
  });

  // Cast clients to satisfy rare-cli's bundled viem types (runtime-compatible)
  const rare = createRareClient({
    publicClient: publicClient as any,
    walletClient: walletClient as any,
    account: account.address,
  });

  // Build metadata URI (same format as MintFactory path)
  const tokenUri = encodeMetadata(intent.metadata);

  // Mint via Rare Protocol
  const result = await rare.mint.mintTo({
    contract: contractAddress,
    tokenUri,
    to: intent.recipient as `0x${string}`,
  });

  return {
    status: "minted",
    txHash: result.txHash,
    tokenId: result.tokenId?.toString() || "unknown",
    contract: contractAddress,
    platform: "superrare",
    tokenType: TOKEN_TYPE_NAMES[intent.tokenType],
    soulbound: intent.soulbound,
    recipient: intent.recipient,
    chain: "Base",
    explorer: `https://basescan.org/tx/${result.txHash}`,
    tokenUri,
  };
}

export async function deployRareCollection(
  privateKey: string,
  name: string,
  symbol: string,
): Promise<{ contract: string; txHash: string }> {
  const chain = base;
  const account = privateKeyToAccount(privateKey as `0x${string}`);

  const publicClient = createPublicClient({
    chain,
    transport: http(),
  });

  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(),
  });

  const rare = createRareClient({
    publicClient: publicClient as any,
    walletClient: walletClient as any,
    account: account.address,
  });

  const result = await rare.deploy.erc721({ name, symbol });

  return {
    contract: result.contract || "unknown",
    txHash: result.txHash,
  };
}
