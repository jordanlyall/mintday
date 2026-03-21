import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ethers } from "ethers";
import { captureError } from "./lib/sentry.js";

const RPC_URL = process.env.BASE_RPC_URL || "https://base-mainnet.public.blastapi.io";
const CONTRACT = process.env.MINT_FACTORY_ADDRESS || "0x12a1c11a0b2860f64e7d8df20989f97d40de7f2c";
const DEPLOY_BLOCK = 43461700;
const CHUNK_SIZE = 9999;

const TOKEN_TYPES = ["Identity", "Attestation", "Credential", "Receipt", "Pass"];

const ABI = [
  "event Minted(uint256 indexed tokenId, address indexed to, uint8 tokenType, bool soulbound, string tokenURI)",
  "function tokenData(uint256 tokenId) view returns (uint8 tokenType, bool soulbound, uint256 mintedAt)",
  "function ownerOf(uint256 tokenId) view returns (address)",
];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=15, stale-while-revalidate=30");

  const address = (req.query.address as string) || "";

  if (!address || !ethers.isAddress(address)) {
    res.status(400).json({ error: "Valid Ethereum address required. Usage: /api/verify?address=0x..." });
    return;
  }

  try {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const contract = new ethers.Contract(CONTRACT, ABI, provider);
    const latestBlock = await provider.getBlockNumber();

    const filter = contract.filters.Minted(null, address);
    const events: ethers.EventLog[] = [];
    for (let start = DEPLOY_BLOCK; start <= latestBlock; start += CHUNK_SIZE + 1) {
      const end = Math.min(start + CHUNK_SIZE, latestBlock);
      const chunk = await contract.queryFilter(filter, start, end);
      events.push(...(chunk as ethers.EventLog[]));
    }

    const tokens = await Promise.all(
      events.map(async (event) => {
        const tokenId = event.args[0].toString();
        const tokenType = Number(event.args[2]);
        const soulbound = event.args[3];
        const tokenURI = event.args[4];

        let name = null;
        let metadata: Record<string, unknown> = {};
        if (tokenURI.startsWith("data:application/json;base64,")) {
          try {
            metadata = JSON.parse(
              Buffer.from(tokenURI.replace("data:application/json;base64,", ""), "base64").toString()
            );
            name = (metadata.name as string) || null;
          } catch {}
        }

        let currentOwner: string | null = null;
        try {
          currentOwner = await contract.ownerOf(tokenId);
        } catch {}

        return {
          tokenId: Number(tokenId),
          tokenType: TOKEN_TYPES[tokenType] || `Unknown(${tokenType})`,
          soulbound,
          name,
          currentOwner,
          did: metadata.did || null,
          capabilities: metadata.capabilities || null,
          txHash: event.transactionHash,
        };
      })
    );

    const hasIdentity = tokens.some((t) => t.tokenType === "Identity");
    const credentials = tokens.filter((t) => t.tokenType === "Credential");
    const attestations = tokens.filter((t) => t.tokenType === "Attestation");

    res.status(200).json({
      address,
      verified: tokens.length > 0,
      hasIdentity,
      credentialCount: credentials.length,
      attestationCount: attestations.length,
      totalTokens: tokens.length,
      tokens,
    });
  } catch (err: any) {
    captureError(err, { route: "verify", address });
    res.status(500).json({ error: err.message || "Failed to verify" });
  }
}
