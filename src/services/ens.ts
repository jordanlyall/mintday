import { ethers } from "ethers";

// ENS lives on Ethereum mainnet, need an L1 provider for resolution
const ENS_RPC = process.env.ENS_RPC_URL || "https://eth.llamarpc.com";
let ensProvider: ethers.JsonRpcProvider | null = null;

function getEnsProvider(): ethers.JsonRpcProvider {
  if (!ensProvider) {
    ensProvider = new ethers.JsonRpcProvider(ENS_RPC);
  }
  return ensProvider;
}

export function looksLikeEns(input: string): boolean {
  return /^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}$/.test(input) && !input.startsWith("0x");
}

export async function resolveEns(nameOrAddress: string): Promise<string> {
  if (!looksLikeEns(nameOrAddress)) return nameOrAddress;

  const provider = getEnsProvider();
  const resolved = await provider.resolveName(nameOrAddress);
  if (!resolved) {
    throw new Error(`Could not resolve ENS name: ${nameOrAddress}`);
  }
  return resolved;
}

export async function reverseResolve(address: string): Promise<string | null> {
  try {
    const provider = getEnsProvider();
    return await provider.lookupAddress(address);
  } catch {
    return null;
  }
}
