import { ethers } from "ethers";
import { MintIntent, CalldataResult, TOKEN_TYPE_NAMES } from "../types.js";
import { encodeMetadata } from "./metadata.js";

const MINT_FACTORY_ABI = [
  "function mint(address to, string uri, uint8 tokenType, bool soulbound) payable returns (uint256)",
  "function mintFee() view returns (uint256)",
  "function totalMinted() view returns (uint256)",
];

export class CalldataService {
  private contract: ethers.Contract;
  private contractAddress: string;
  private chainId: number;
  readonly provider: ethers.JsonRpcProvider;

  constructor(rpcUrl: string, contractAddress: string, chainId: number) {
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.contract = new ethers.Contract(contractAddress, MINT_FACTORY_ABI, this.provider);
    this.contractAddress = contractAddress;
    this.chainId = chainId;
  }

  async buildMintCalldata(intent: MintIntent): Promise<CalldataResult> {
    const tokenURI = encodeMetadata(intent.metadata);

    const calldata = this.contract.interface.encodeFunctionData("mint", [
      intent.recipient,
      tokenURI,
      intent.tokenType,
      intent.soulbound,
    ]);

    const mintFee = await this.contract.mintFee();

    // Dynamic gas estimation with 20% buffer, fallback to safe static value
    let estimatedGas = 600000;
    try {
      const estimate = await this.provider.estimateGas({
        to: this.contractAddress,
        data: calldata,
        value: mintFee,
      });
      estimatedGas = Math.ceil(Number(estimate) * 1.2);
    } catch {
      // Estimation can fail if caller has no funds; use safe default
    }

    return {
      to: this.contractAddress,
      calldata,
      value: mintFee.toString(),
      estimatedGas,
      chainId: this.chainId,
      metadata: intent.metadata,
      tokenType: TOKEN_TYPE_NAMES[intent.tokenType],
      soulbound: intent.soulbound,
    };
  }

  async totalMinted(): Promise<string> {
    const total = await this.contract.totalMinted();
    return total.toString();
  }

  async mintFee(): Promise<string> {
    const fee = await this.contract.mintFee();
    return ethers.formatEther(fee);
  }
}
