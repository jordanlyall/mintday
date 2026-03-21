import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ethers } from "ethers";
import { captureError } from "./lib/sentry.js";

const PRIVATE_KEY = process.env.SPONSORED_KEY;
const RPC_URL = process.env.BASE_RPC_URL || "https://mainnet.base.org";
const CONTRACT = process.env.MINT_FACTORY_ADDRESS || "0x12a1c11a0b2860f64e7d8df20989f97d40de7f2c";

// Rate limiting: per-address and global
const addrLimits = new Map<string, { count: number; resetAt: number }>();
const globalState = { count: 0, resetAt: 0 };
const ADDR_LIMIT = 10;       // 10 mints per address per hour
const GLOBAL_HOUR_LIMIT = 50; // 50 mints per hour
const GLOBAL_DAY_LIMIT = 500; // 500 mints per day
const HOUR_MS = 60 * 60 * 1000;

const dailyState = { count: 0, resetAt: 0 };

function checkRateLimit(recipient: string): string | null {
  const now = Date.now();

  // Per-address hourly limit
  const addr = addrLimits.get(recipient);
  if (!addr || now > addr.resetAt) {
    addrLimits.set(recipient, { count: 1, resetAt: now + HOUR_MS });
  } else if (addr.count >= ADDR_LIMIT) {
    return `Address rate limited (${ADDR_LIMIT}/hour). Try again later.`;
  } else {
    addr.count++;
  }

  // Global hourly limit
  if (now > globalState.resetAt) {
    globalState.count = 1;
    globalState.resetAt = now + HOUR_MS;
  } else if (globalState.count >= GLOBAL_HOUR_LIMIT) {
    return `Global hourly limit reached (${GLOBAL_HOUR_LIMIT}/hour). Try again later.`;
  } else {
    globalState.count++;
  }

  // Global daily limit
  if (now > dailyState.resetAt) {
    dailyState.count = 1;
    dailyState.resetAt = now + 24 * HOUR_MS;
  } else if (dailyState.count >= GLOBAL_DAY_LIMIT) {
    return `Global daily limit reached (${GLOBAL_DAY_LIMIT}/day). Try again tomorrow.`;
  } else {
    dailyState.count++;
  }

  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  if (!PRIVATE_KEY) {
    return res.status(503).json({ error: "Sponsored minting not configured" });
  }

  const { to, calldata, value, estimatedGas, recipient } = req.body || {};

  if (!to || !calldata || !recipient) {
    return res.status(400).json({ error: "Missing required fields: to, calldata, recipient" });
  }

  if (!ethers.isAddress(to) || !ethers.isAddress(recipient)) {
    return res.status(400).json({ error: "Invalid address" });
  }

  // Verify the target is our contract
  if (to.toLowerCase() !== CONTRACT.toLowerCase()) {
    return res.status(400).json({ error: "Invalid contract target" });
  }

  const rateLimitError = checkRateLimit(recipient.toLowerCase());
  if (rateLimitError) {
    return res.status(429).json({ error: rateLimitError });
  }

  try {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

    const tx = await wallet.sendTransaction({
      to,
      data: calldata,
      value: BigInt(value || "0"),
      gasLimit: estimatedGas || 600000,
    });

    const receipt = await tx.wait();

    return res.status(200).json({
      txHash: receipt!.hash,
      blockNumber: receipt!.blockNumber,
      gasUsed: receipt!.gasUsed.toString(),
      explorer: `https://basescan.org/tx/${receipt!.hash}`,
    });
  } catch (err) {
    captureError(err, { route: "sponsor", recipient: recipient || "unknown" });
    const message = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: `Transaction failed: ${message}` });
  }
}
