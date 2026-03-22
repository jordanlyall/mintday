declare module "@rareprotocol/rare-cli/client" {
  import { PublicClient, WalletClient, Address, Hash, TransactionReceipt } from "viem";

  interface RareClientConfig {
    publicClient: PublicClient;
    walletClient?: WalletClient;
    account?: Address;
  }

  interface TransactionResult {
    txHash: Hash;
    receipt: TransactionReceipt;
  }

  interface DeployErc721Result extends TransactionResult {
    contract: Address | undefined;
  }

  interface MintToResult extends TransactionResult {
    tokenId: bigint | undefined;
  }

  interface RareClient {
    deploy: {
      erc721(params: { name: string; symbol: string; maxTokens?: bigint | number | string }): Promise<DeployErc721Result>;
    };
    mint: {
      mintTo(params: { contract: Address; tokenUri: string; to?: Address; royaltyReceiver?: Address }): Promise<MintToResult>;
    };
    media: {
      upload(buffer: Uint8Array, filename: string): Promise<{ url: string; mimeType: string; size: number }>;
      pinMetadata(opts: { name: string; description: string; image: { url: string; mimeType: string; size: number } }): Promise<string>;
    };
  }

  export function createRareClient(config: RareClientConfig): RareClient;
}
