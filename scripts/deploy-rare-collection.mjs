#!/usr/bin/env node
/**
 * Deploy a mint.day collection on Rare Protocol (SuperRare).
 *
 * Usage:
 *   node scripts/deploy-rare-collection.mjs [--testnet]
 *
 * Requires: PRIVATE_KEY env var or ~/.mint-day/credentials
 * Output: prints the contract address to set as RARE_CONTRACT
 */

import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import { createRareClient } from "@rareprotocol/rare-cli/client";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const isTestnet = process.argv.includes("--testnet");
const chain = isTestnet ? baseSepolia : base;

// Load private key
let privateKey = process.env.PRIVATE_KEY || "";
if (!privateKey) {
  const credPath = join(homedir(), ".mint-day", "credentials");
  if (existsSync(credPath)) {
    privateKey = readFileSync(credPath, "utf-8").trim();
  }
}

if (!privateKey) {
  console.error("No private key found. Set PRIVATE_KEY env var or save to ~/.mint-day/credentials");
  process.exit(1);
}

const account = privateKeyToAccount(privateKey);
console.log(`Deploying mint.day collection on ${isTestnet ? "Base Sepolia" : "Base"}...`);
console.log(`Deployer: ${account.address}`);

const publicClient = createPublicClient({ chain, transport: http() });
const walletClient = createWalletClient({ account, chain, transport: http() });

const rare = createRareClient({
  publicClient,
  walletClient,
  account: account.address,
});

try {
  const result = await rare.deploy.erc721({
    name: "mint.day",
    symbol: "MINTDAY",
  });

  console.log(`\nCollection deployed!`);
  console.log(`Contract: ${result.contract}`);
  console.log(`TX: https://${isTestnet ? "sepolia." : ""}basescan.org/tx/${result.txHash}`);
  console.log(`\nSet this in your environment:`);
  console.log(`  export RARE_CONTRACT=${result.contract}`);
} catch (err) {
  console.error("Deploy failed:", err.message || err);
  process.exit(1);
}
