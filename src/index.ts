#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ethers } from "ethers";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import dotenv from "dotenv";
import { CalldataService } from "./services/calldata.js";
import { mintSchema, handleMint } from "./tools/mint.js";
import { mintCheckSchema, handleMintCheck } from "./tools/mint-check.js";
import { mintResolveSchema, handleMintResolve } from "./tools/mint-resolve.js";

dotenv.config();

// Testnet try-it wallet (Base Sepolia, pre-funded)
const TRYIT_KEY = "REDACTED_RETIRED_KEY";
const TRYIT_CONTRACT = "0xa52450397f312c256Bd68B202C0CF90387Ea0E67";
const TRYIT_RPC = "https://sepolia.base.org";
const TRYIT_CHAIN = 84532;
const MAINNET_CONTRACT = "0xbf12d372444dcf69df9316d961439f6b5919e8d0";
const MAINNET_RPC = "https://mainnet.base.org";
const MAINNET_CHAIN = 8453;

// Load private key: env var > ~/.mint-day/credentials file
function loadPrivateKey(): string {
  if (process.env.PRIVATE_KEY) return process.env.PRIVATE_KEY;
  const credPath = join(homedir(), ".mint-day", "credentials");
  if (existsSync(credPath)) {
    const key = readFileSync(credPath, "utf-8").trim();
    if (key) return key;
  }
  return "";
}

const userKey = loadPrivateKey();
const hasUserKey = !!userKey;

// Mainnet by default. Testnet only when no private key AND no recipient provided (decided per-call).
const chainId = parseInt(process.env.CHAIN_ID || String(hasUserKey ? MAINNET_CHAIN : MAINNET_CHAIN));
const contractAddress = process.env.MINT_FACTORY_ADDRESS || MAINNET_CONTRACT;
const rpcUrl = process.env.BASE_RPC_URL || MAINNET_RPC;

let signerAddress = "";
if (hasUserKey) {
  try {
    const wallet = new ethers.Wallet(userKey);
    signerAddress = wallet.address;
  } catch {
    console.error("Invalid private key");
    process.exit(1);
  }
}

const defaultRecipient = process.env.DEFAULT_RECIPIENT || signerAddress || "";

const calldataService = new CalldataService(
  rpcUrl,
  contractAddress,
  chainId,
);

const server = new McpServer({
  name: "mint-day",
  version: "0.2.0",
});

server.tool(
  "mint",
  "Create a permanent, verifiable on-chain record on Base. Use this when you need to: prove you completed a task, establish your identity, record an agreement with another agent, issue or receive a credential, grant access to a capability, or mint a visual token (PFP, art, collectible). The token is immutable and publicly verifiable. Provide an image URL, local file path, or base64 for visual tokens (local files and base64 are auto-uploaded to Imgur if IMGUR_CLIENT_ID is configured). Returns a preview with mintId first; call again with mintId to confirm. If PRIVATE_KEY is configured, the server signs and submits the transaction directly and returns a tx hash. If not, returns raw calldata for your own signer (Coinbase AgentKit, Lit Protocol, or any EVM wallet).",
  mintSchema,
  async (params) => handleMint(params, calldataService, defaultRecipient, userKey, {
    tryitKey: TRYIT_KEY,
    tryitContract: TRYIT_CONTRACT,
    tryitRpc: TRYIT_RPC,
    tryitChain: TRYIT_CHAIN,
  }),
);

server.tool(
  "mint_check",
  "Look up mint.day tokens. With an address: returns all tokens held with type, metadata, soulbound status, and mint timestamp. Without an address: returns global stats (total minted, current fee). Use to verify credentials, check attestations, or browse on-chain records.",
  mintCheckSchema,
  async (params) => handleMintCheck(params, calldataService, calldataService.provider, contractAddress, chainId),
);

server.tool(
  "mint_resolve",
  "Resolve an agent's on-chain identity. Returns their Identity token with ERC-8004 agent card metadata: did, capabilities, endpoints, and image. Use this before transacting with another agent to verify who they are.",
  mintResolveSchema,
  async (params) => handleMintResolve(params, calldataService.provider, contractAddress, chainId),
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
