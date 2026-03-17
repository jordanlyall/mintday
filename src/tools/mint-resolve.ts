import { z } from "zod";
import { ethers } from "ethers";

const TOKEN_TYPE_NAMES = ["Identity", "Attestation", "Credential", "Receipt", "Pass"];

const MINT_FACTORY_ABI = [
  "event Minted(uint256 indexed tokenId, address indexed to, uint8 tokenType, bool soulbound, string tokenURI)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function tokenData(uint256 tokenId) view returns (uint8 tokenType, bool soulbound, uint256 mintedAt)",
  "function ownerOf(uint256 tokenId) view returns (address)",
];

const DEPLOY_BLOCKS: Record<number, number> = {
  8453: 28000000,
  84532: 22000000,
};

export const mintResolveSchema = {
  address: z
    .string()
    .describe("Ethereum address to resolve. Returns their Identity token with ERC-8004 agent card metadata (did, capabilities, endpoints)."),
};

export async function handleMintResolve(
  params: { address: string },
  provider: ethers.JsonRpcProvider,
  contractAddress: string,
  chainId: number,
) {
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

  // Query all Minted events to this address
  const filter = contract.filters.Minted(null, params.address);
  const events = await contract.queryFilter(filter, fromBlock, "latest");

  // Find Identity tokens (tokenType === 0)
  let identityEvent: ethers.EventLog | null = null;
  for (const event of events) {
    const log = event as ethers.EventLog;
    if (Number(log.args[2]) === 0) {
      identityEvent = log; // take the latest Identity token
    }
  }

  if (!identityEvent) {
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          address: params.address,
          identity: null,
          message: "No Identity token found for this address.",
        }, null, 2),
      }],
    };
  }

  const tokenId = identityEvent.args[0].toString();

  let currentOwner: string | null = null;
  try {
    currentOwner = await contract.ownerOf(tokenId);
  } catch {
    currentOwner = null;
  }

  const [, soulbound, mintedAt] = await contract.tokenData(tokenId);
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
    content: [{
      type: "text" as const,
      text: JSON.stringify({
        address: params.address,
        identity: {
          tokenId,
          soulbound: Boolean(soulbound),
          mintedAt: new Date(Number(mintedAt) * 1000).toISOString(),
          currentOwner,
          did: metadata.did || null,
          capabilities: metadata.capabilities || [],
          endpoints: metadata.endpoints || [],
          name: metadata.name || null,
          description: metadata.description || null,
          image: metadata.image || null,
        },
      }, null, 2),
    }],
  };
}
