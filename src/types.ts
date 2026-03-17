export enum TokenType {
  Identity = 0,
  Attestation = 1,
  Credential = 2,
  Receipt = 3,
  Pass = 4,
}

export const TOKEN_TYPE_NAMES = ["Identity", "Attestation", "Credential", "Receipt", "Pass"] as const;

export interface MintIntent {
  tokenType: TokenType;
  soulbound: boolean;
  recipient: string;
  metadata: TokenMetadata;
  missingFields?: string[];
}

export interface TokenMetadata {
  name: string;
  description: string;
  tokenType: string;
  soulbound: boolean;
  creator: string;
  recipient: string;
  timestamp: string;
  chainId: number;
  mintday_version: string;
  image?: string;
  animation_url?: string;
  [key: string]: unknown;
}

export interface CalldataResult {
  to: string;
  calldata: string;
  value: string;
  estimatedGas: number;
  chainId: number;
  metadata: TokenMetadata;
  tokenType: string;
  soulbound: boolean;
}
