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
];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=60");

  try {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const contract = new ethers.Contract(CONTRACT, ABI, provider);

    const latestBlock = await provider.getBlockNumber();

    const filter = contract.filters.Minted();
    const events: ethers.EventLog[] = [];
    for (let start = DEPLOY_BLOCK; start <= latestBlock; start += CHUNK_SIZE + 1) {
      const end = Math.min(start + CHUNK_SIZE, latestBlock);
      const chunk = await contract.queryFilter(filter, start, end);
      events.push(...(chunk as ethers.EventLog[]));
    }

    const tokens = events.map((event) => {
      const tokenId = event.args[0].toString();
      const to = event.args[1];
      const tokenType = Number(event.args[2]);
      const soulbound = event.args[3];
      const tokenURI = event.args[4];

      let name = null;
      if (tokenURI.startsWith("data:application/json;base64,")) {
        try {
          const meta = JSON.parse(
            Buffer.from(tokenURI.replace("data:application/json;base64,", ""), "base64").toString()
          );
          name = meta.name || null;
        } catch {}
      }

      return {
        tokenId: Number(tokenId),
        recipient: to,
        tokenType: TOKEN_TYPES[tokenType] || `Unknown(${tokenType})`,
        soulbound,
        name,
        block: event.blockNumber,
        txHash: event.transactionHash,
      };
    });

    res.status(200).json({
      totalMinted: tokens.length,
      contract: CONTRACT,
      chain: "Base",
      chainId: 8453,
      tokens: tokens.reverse(),
    });
  } catch (err: any) {
    captureError(err, { route: "feed" });
    res.status(500).json({ error: err.message || "Failed to fetch feed" });
  }
}
