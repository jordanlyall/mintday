import { z } from "zod";
import { ethers } from "ethers";
import { CalldataService } from "../services/calldata.js";

const TOKEN_TYPE_NAMES = ["Identity", "Attestation", "Credential", "Receipt", "Pass"];

const MINT_FACTORY_ABI = [
  "event Minted(uint256 indexed tokenId, address indexed to, uint8 tokenType, bool soulbound, string tokenURI)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function tokenData(uint256 tokenId) view returns (uint8 tokenType, bool soulbound, uint256 mintedAt)",
  "function ownerOf(uint256 tokenId) view returns (address)",
];

// Deploy blocks per chain to avoid scanning from genesis
const DEPLOY_BLOCKS: Record<number, number> = {
  8453: 28000000,   // Base mainnet (approximate, update after deploy)
  84532: 22000000,  // Base Sepolia (approximate)
};

export const mintCheckSchema = {
  address: z
    .string()
    .optional()
    .describe("Ethereum address to check for mint.day tokens. If omitted, returns global stats."),
  txHash: z
    .string()
    .optional()
    .describe("Transaction hash to look up a specific mint. Returns token details from the tx receipt."),
};

export async function handleMintCheck(
  params: { address?: string; txHash?: string },
  calldataService: CalldataService,
  provider: ethers.JsonRpcProvider,
  contractAddress: string,
  chainId: number,
) {
  // Tx hash lookup: get token details from a specific transaction
  if (params.txHash) {
    const receipt = await provider.getTransactionReceipt(params.txHash);
    if (!receipt) {
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ error: "Transaction not found." }, null, 2),
        }],
      };
    }

    const contract = new ethers.Contract(contractAddress, MINT_FACTORY_ABI, provider);
    const mintedLogs = receipt.logs
      .filter(log => log.address.toLowerCase() === contractAddress.toLowerCase())
      .map(log => {
        try { return contract.interface.parseLog({ topics: [...log.topics], data: log.data }); }
        catch { return null; }
      })
      .filter(parsed => parsed?.name === "Minted");

    if (mintedLogs.length === 0) {
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ error: "No mint.day Minted event found in this transaction.", txHash: params.txHash }, null, 2),
        }],
      };
    }

    const tokens = await Promise.all(mintedLogs.map(async (log) => {
      const tokenId = log!.args[0].toString();
      const to = log!.args[1];
      const tokenType = Number(log!.args[2]);
      const soulbound = Boolean(log!.args[3]);
      const uri = await contract.tokenURI(tokenId);

      let metadata: Record<string, unknown> = {};
      if (uri.startsWith("data:application/json;base64,")) {
        try {
          metadata = JSON.parse(Buffer.from(uri.replace("data:application/json;base64,", ""), "base64").toString());
        } catch { metadata = { raw: uri }; }
      }

      return {
        tokenId,
        to,
        tokenType: TOKEN_TYPE_NAMES[tokenType] || "Unknown",
        soulbound,
        metadata,
      };
    }));

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          txHash: params.txHash,
          blockNumber: receipt.blockNumber,
          status: receipt.status === 1 ? "success" : "failed",
          tokens,
        }, null, 2),
      }],
    };
  }

  // No address: return global stats (replaces mint_status)
  if (!params.address) {
    const total = await calldataService.totalMinted();
    const fee = await calldataService.mintFee();
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({ totalMinted: total, mintFee: `${fee} ETH`, chainId }, null, 2),
      }],
    };
  }

  // Validate address
  if (!ethers.isAddress(params.address)) {
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({ error: `Invalid Ethereum address: ${params.address}` }, null, 2),
      }],
    };
  }

  const contract = new ethers.Contract(contractAddress, MINT_FACTORY_ABI, provider);
  const fromBlock = DEPLOY_BLOCKS[chainId] || 0;
  const filter = contract.filters.Minted(null, params.address);
  const events = await contract.queryFilter(filter, fromBlock, "latest");

  if (events.length === 0) {
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({ address: params.address, tokens: [], count: 0 }, null, 2),
      }],
    };
  }

  const tokens = await Promise.all(
    events.map(async (event) => {
      const log = event as ethers.EventLog;
      const tokenId = log.args[0].toString();

      let currentOwner: string | null = null;
      try {
        currentOwner = await contract.ownerOf(tokenId);
      } catch {
        currentOwner = null; // burned
      }

      const [tokenType, soulbound, mintedAt] = await contract.tokenData(tokenId);
      const uri = await contract.tokenURI(tokenId);

      let metadata: Record<string, unknown> = {};
      if (uri.startsWith("data:application/json;base64,")) {
        const base64 = uri.replace("data:application/json;base64,", "");
        try {
          metadata = JSON.parse(Buffer.from(base64, "base64").toString());
        } catch {
          metadata = { raw: uri };
        }
      }

      return {
        tokenId,
        tokenType: TOKEN_TYPE_NAMES[Number(tokenType)] || "Unknown",
        soulbound: Boolean(soulbound),
        mintedAt: new Date(Number(mintedAt) * 1000).toISOString(),
        currentOwner,
        metadata,
      };
    }),
  );

  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({ address: params.address, tokens, count: tokens.length }, null, 2),
    }],
  };
}
