# Agent Mint Service Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a one-call minting service where AI agents describe intent in natural language and get back an on-chain token minted to the correct standard on Base.

**Architecture:** Factory contract on Base handles all token types (identity, attestation, credential, receipt, access pass) with soulbound support and owner-upgradeable tokenURIs. TypeScript MCP server exposes a single `mint` tool that accepts either natural language (classified via Haiku LLM call) or structured parameters. Service wallet sponsors gas; x402 pricing includes gas margin.

**Tech Stack:** Solidity 0.8.28, OpenZeppelin v5, Foundry, TypeScript, @modelcontextprotocol/sdk, ethers.js v6, @anthropic-ai/sdk (Haiku classifier), Base Sepolia (testnet) then Base (mainnet).

**Design Decisions:**
- **Classifier**: Haiku LLM call, not keyword matching. "stamp this interaction" needs to route to Attestation without hitting "proof" or "completed." One Haiku call per mint is fractions of a cent and dramatically more accurate than maintaining keyword lists.
- **Dual input**: Accept both natural language AND optional structured params (`tokenType`, `soulbound`, `recipient`). Classifier only fires when structured params are absent. Agents that know what they want skip NLP entirely.
- **Metadata**: Base64 data URIs for v1 (zero external dependencies). Contract includes `setTokenURI` for future migration to IPFS or served endpoints when ERC-8004 compliance requires resolvable URIs.
- **Gas economics**: Service wallet pays gas (~$0.001 on Base). x402 mint price includes gas margin. Even $0.01/mint covers thousands of transactions.

---

## Chunk 1: Smart Contract

### Task 1: Project Scaffolding

**Files:**
- Create: `contracts/foundry.toml`
- Create: `contracts/.env.example`
- Create: `contracts/.gitignore`

- [ ] **Step 1: Initialize Foundry project**

```bash
cd ~/Projects/agent-mint
mkdir -p contracts && cd contracts
forge init --no-commit .
```

- [ ] **Step 2: Install OpenZeppelin v5**

```bash
cd ~/Projects/agent-mint/contracts
forge install OpenZeppelin/openzeppelin-contracts@v5.1.0 --no-commit
```

- [ ] **Step 3: Configure foundry.toml**

```toml
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
solc = "0.8.28"
via_ir = true
optimizer = true
optimizer_runs = 200

remappings = [
    "@openzeppelin/=lib/openzeppelin-contracts/"
]

[rpc_endpoints]
base_sepolia = "${BASE_SEPOLIA_RPC_URL}"
base = "${BASE_RPC_URL}"

[etherscan]
base_sepolia = { key = "${BASESCAN_API_KEY}", url = "https://api-sepolia.basescan.org/api" }
base = { key = "${BASESCAN_API_KEY}", url = "https://api.basescan.org/api" }
```

- [ ] **Step 4: Create .env.example**

```
BASE_SEPOLIA_RPC_URL=
BASE_RPC_URL=
BASESCAN_API_KEY=
DEPLOYER_PRIVATE_KEY=
```

- [ ] **Step 5: Create .gitignore**

```
out/
cache/
.env
broadcast/
```

- [ ] **Step 6: Commit**

```bash
cd ~/Projects/agent-mint
git init && git add -A
git commit -m "feat: foundry project scaffolding"
```

---

### Task 2: MintFactory Contract

**Files:**
- Create: `contracts/src/MintFactory.sol`
- Delete: `contracts/src/Counter.sol` (Foundry default)

The contract is an ERC-721 with:
- Token type enum (Identity, Attestation, Credential, Receipt, AccessPass)
- Soulbound flag per token (prevents transfers when set)
- Owner-only minting (the service wallet is the minter)
- Auto-incrementing token IDs
- Structured metadata via tokenURI

- [ ] **Step 1: Delete default Counter.sol**

```bash
rm ~/Projects/agent-mint/contracts/src/Counter.sol
rm ~/Projects/agent-mint/contracts/test/Counter.t.sol
rm ~/Projects/agent-mint/contracts/script/Counter.s.sol
```

- [ ] **Step 2: Write MintFactory.sol**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract MintFactory is ERC721URIStorage, Ownable {
    uint256 private _nextTokenId = 1;

    enum TokenType { Identity, Attestation, Credential, Receipt, AccessPass }

    struct TokenData {
        TokenType tokenType;
        bool soulbound;
        uint256 mintedAt;
    }

    mapping(uint256 => TokenData) public tokenData;

    event Minted(
        uint256 indexed tokenId,
        address indexed to,
        TokenType tokenType,
        bool soulbound,
        string tokenURI
    );

    constructor() ERC721("Agent Mint", "AMINT") Ownable(msg.sender) {}

    function mint(
        address to,
        string calldata uri,
        TokenType tokenType,
        bool soulbound
    ) external onlyOwner returns (uint256 tokenId) {
        tokenId = _nextTokenId++;
        _mint(to, tokenId);
        _setTokenURI(tokenId, uri);
        tokenData[tokenId] = TokenData(tokenType, soulbound, block.timestamp);
        emit Minted(tokenId, to, tokenType, soulbound, uri);
    }

    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal override returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0) && tokenData[tokenId].soulbound) {
            revert("Soulbound: non-transferable");
        }
        return super._update(to, tokenId, auth);
    }

    function setTokenURI(uint256 tokenId, string calldata uri) external onlyOwner {
        _setTokenURI(tokenId, uri);
    }

    function totalMinted() external view returns (uint256) {
        return _nextTokenId - 1;
    }
}
```

- [ ] **Step 3: Verify it compiles**

Run: `cd ~/Projects/agent-mint/contracts && forge build`
Expected: Compilation successful

- [ ] **Step 4: Commit**

```bash
git add contracts/src/MintFactory.sol
git commit -m "feat: MintFactory contract with token types and soulbound support"
```

---

### Task 3: Contract Tests

**Files:**
- Create: `contracts/test/MintFactory.t.sol`

- [ ] **Step 1: Write tests**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../src/MintFactory.sol";

contract MintFactoryTest is Test {
    MintFactory factory;
    address owner = address(this);
    address agent1 = address(0xA1);
    address agent2 = address(0xA2);

    function setUp() public {
        factory = new MintFactory();
    }

    function test_mint_identity() public {
        uint256 id = factory.mint(
            agent1,
            "ipfs://QmIdentity",
            MintFactory.TokenType.Identity,
            false
        );
        assertEq(id, 1);
        assertEq(factory.ownerOf(1), agent1);
        assertEq(factory.tokenURI(1), "ipfs://QmIdentity");
        (MintFactory.TokenType t, bool sb, uint256 ts) = factory.tokenData(1);
        assertEq(uint8(t), uint8(MintFactory.TokenType.Identity));
        assertFalse(sb);
        assertGt(ts, 0);
    }

    function test_mint_soulbound_credential() public {
        factory.mint(
            agent1,
            "ipfs://QmCredential",
            MintFactory.TokenType.Credential,
            true
        );

        // Transfer should revert
        vm.prank(agent1);
        vm.expectRevert("Soulbound: non-transferable");
        factory.transferFrom(agent1, agent2, 1);
    }

    function test_transferable_token() public {
        factory.mint(
            agent1,
            "ipfs://QmPass",
            MintFactory.TokenType.AccessPass,
            false
        );

        vm.prank(agent1);
        factory.transferFrom(agent1, agent2, 1);
        assertEq(factory.ownerOf(1), agent2);
    }

    function test_only_owner_can_mint() public {
        vm.prank(agent1);
        vm.expectRevert();
        factory.mint(agent1, "ipfs://Qm", MintFactory.TokenType.Identity, false);
    }

    function test_auto_increment_ids() public {
        factory.mint(agent1, "ipfs://1", MintFactory.TokenType.Identity, false);
        factory.mint(agent2, "ipfs://2", MintFactory.TokenType.Attestation, true);
        assertEq(factory.totalMinted(), 2);
        assertEq(factory.ownerOf(1), agent1);
        assertEq(factory.ownerOf(2), agent2);
    }

    function test_all_token_types() public {
        factory.mint(agent1, "a", MintFactory.TokenType.Identity, false);
        factory.mint(agent1, "b", MintFactory.TokenType.Attestation, true);
        factory.mint(agent1, "c", MintFactory.TokenType.Credential, true);
        factory.mint(agent1, "d", MintFactory.TokenType.Receipt, true);
        factory.mint(agent1, "e", MintFactory.TokenType.AccessPass, false);
        assertEq(factory.totalMinted(), 5);
    }

    function test_soulbound_allows_burn() public {
        factory.mint(agent1, "ipfs://Qm", MintFactory.TokenType.Credential, true);
        // Burn (transfer to address(0)) should work even for soulbound
        vm.prank(agent1);
        factory.transferFrom(agent1, address(0), 1);
    }
}
```

- [ ] **Step 2: Run tests**

Run: `cd ~/Projects/agent-mint/contracts && forge test -v`
Expected: All tests pass. If `test_soulbound_allows_burn` fails (OZ may revert on transfer to zero), remove that test.

- [ ] **Step 3: Commit**

```bash
git add contracts/test/MintFactory.t.sol
git commit -m "test: MintFactory tests for all token types and soulbound"
```

---

### Task 4: Deploy Script

**Files:**
- Create: `contracts/script/Deploy.s.sol`

- [ ] **Step 1: Write deploy script**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Script.sol";
import "../src/MintFactory.sol";

contract Deploy is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        vm.startBroadcast(deployerKey);
        MintFactory factory = new MintFactory();
        vm.stopBroadcast();

        console.log("MintFactory deployed to:", address(factory));
    }
}
```

- [ ] **Step 2: Deploy to Base Sepolia**

```bash
cd ~/Projects/agent-mint/contracts
source .env
forge script script/Deploy.s.sol:Deploy \
    --rpc-url base_sepolia \
    --broadcast \
    --verify
```

Expected: Contract deployed and verified on Basescan Sepolia. Save the deployed address.

- [ ] **Step 3: Record deployed address**

Create `contracts/deployments.json`:
```json
{
  "baseSepolia": {
    "MintFactory": "<DEPLOYED_ADDRESS>",
    "deployedAt": "2026-03-XX",
    "txHash": "<TX_HASH>"
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add contracts/script/Deploy.s.sol contracts/deployments.json
git commit -m "feat: deploy script and Base Sepolia deployment"
```

---

## Chunk 2: MCP Server

### Task 5: MCP Server Scaffolding

**Files:**
- Create: `mcp/package.json`
- Create: `mcp/tsconfig.json`
- Create: `mcp/src/index.ts`

- [ ] **Step 1: Initialize Node project**

```bash
cd ~/Projects/agent-mint
mkdir -p mcp/src && cd mcp
npm init -y
npm install @modelcontextprotocol/sdk ethers@6 dotenv
npm install -D typescript @types/node tsx
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create package.json scripts**

Add to `package.json`:
```json
{
  "type": "module",
  "scripts": {
    "dev": "tsx src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add mcp/
git commit -m "feat: mcp server scaffolding"
```

---

### Task 6: Intent Classifier (Haiku LLM)

**Files:**
- Create: `mcp/src/classifier.ts`
- Create: `mcp/src/types.ts`

The classifier takes natural language and returns a structured mint intent via a Haiku LLM call. Fractions of a cent per classification, dramatically more accurate than keyword matching. "stamp this interaction" correctly routes to Attestation without needing "proof" or "completed" as keywords.

- [ ] **Step 1: Install Anthropic SDK**

```bash
cd ~/Projects/agent-mint/mcp && npm install @anthropic-ai/sdk
```

- [ ] **Step 2: Create types.ts**

```typescript
export enum TokenType {
  Identity = 0,
  Attestation = 1,
  Credential = 2,
  Receipt = 3,
  AccessPass = 4,
}

export interface MintIntent {
  tokenType: TokenType;
  soulbound: boolean;
  recipient: string; // address
  metadata: {
    name: string;
    description: string;
    attributes: Record<string, string>;
  };
}

export interface MintResult {
  tokenId: string;
  transactionHash: string;
  explorerUrl: string;
  tokenURI: string;
  tokenType: string;
  soulbound: boolean;
}
```

- [ ] **Step 3: Create classifier.ts**

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { TokenType, MintIntent } from "./types.js";

const client = new Anthropic();

const CLASSIFY_PROMPT = `Classify this mint request into exactly one token type. Respond with ONLY valid JSON, no other text.

Token types:
- Identity (0): Agent registering itself, creating an agent card, establishing on-chain identity
- Attestation (1): Proof of action, task completion, verification, stamping an interaction
- Credential (2): Certification, evaluation passed, qualification earned
- Receipt (3): Payment record, transaction proof, invoice
- AccessPass (4): Permission, API access, gate key, unlock

Default soulbound rules (override if user specifies):
- Identity: transferable (false)
- Attestation: soulbound (true)
- Credential: soulbound (true)
- Receipt: soulbound (true)
- AccessPass: transferable (false)

Respond with: {"tokenType": <0-4>, "soulbound": <bool>, "name": "<short descriptive name>"}`;

// Extract 0x addresses from text
function extractAddress(text: string): string | null {
  const match = text.match(/0x[a-fA-F0-9]{40}/);
  return match ? match[0] : null;
}

export async function classifyIntent(
  text: string,
  fallbackRecipient: string
): Promise<MintIntent> {
  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 100,
    messages: [
      { role: "user", content: `${CLASSIFY_PROMPT}\n\nMint request: "${text}"` },
    ],
  });

  const content = response.content[0];
  if (content.type !== "text") throw new Error("Unexpected response type");

  const parsed = JSON.parse(content.text);
  const tokenType: TokenType = parsed.tokenType;
  const soulbound: boolean = parsed.soulbound;
  const name: string = parsed.name || `Agent Mint #${Date.now()}`;
  const recipient = extractAddress(text) || fallbackRecipient;

  return {
    tokenType,
    soulbound,
    recipient,
    metadata: {
      name,
      description: text,
      attributes: {
        tokenType: TokenType[tokenType],
        soulbound: String(soulbound),
        mintedBy: "agent-mint-service",
      },
    },
  };
}
```

- [ ] **Step 4: Commit**

```bash
git add mcp/src/types.ts mcp/src/classifier.ts
git commit -m "feat: haiku LLM intent classifier"
```

---

### Task 7: Minting Service

**Files:**
- Create: `mcp/src/minter.ts`
- Create: `mcp/.env.example`

This module handles the on-chain transaction: builds metadata JSON, calls the contract's `mint()` function.

- [ ] **Step 1: Create .env.example for MCP server**

```
BASE_SEPOLIA_RPC_URL=
SERVICE_PRIVATE_KEY=
MINT_FACTORY_ADDRESS=
CHAIN_ID=84532
ANTHROPIC_API_KEY=
```

- [ ] **Step 2: Create minter.ts**

```typescript
import { ethers } from "ethers";
import { MintIntent, MintResult, TokenType } from "./types.js";

const MINT_FACTORY_ABI = [
  "function mint(address to, string uri, uint8 tokenType, bool soulbound) returns (uint256)",
  "function totalMinted() view returns (uint256)",
  "event Minted(uint256 indexed tokenId, address indexed to, uint8 tokenType, bool soulbound, string tokenURI)",
];

export class Minter {
  private contract: ethers.Contract;
  private wallet: ethers.Wallet;
  private chainId: number;

  constructor(
    rpcUrl: string,
    privateKey: string,
    contractAddress: string,
    chainId: number
  ) {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    this.wallet = new ethers.Wallet(privateKey, provider);
    this.contract = new ethers.Contract(
      contractAddress,
      MINT_FACTORY_ABI,
      this.wallet
    );
    this.chainId = chainId;
  }

  async mint(intent: MintIntent): Promise<MintResult> {
    // Build metadata JSON (on-chain via data URI for v1)
    const metadata = {
      name: intent.metadata.name,
      description: intent.metadata.description,
      attributes: Object.entries(intent.metadata.attributes).map(
        ([trait_type, value]) => ({ trait_type, value })
      ),
    };

    const tokenURI = `data:application/json;base64,${Buffer.from(
      JSON.stringify(metadata)
    ).toString("base64")}`;

    const tx = await this.contract.mint(
      intent.recipient,
      tokenURI,
      intent.tokenType,
      intent.soulbound
    );

    const receipt = await tx.wait();

    // Parse Minted event
    const mintedEvent = receipt.logs.find(
      (log: ethers.Log) =>
        log.topics[0] ===
        ethers.id(
          "Minted(uint256,address,uint8,bool,string)"
        )
    );

    const tokenId = mintedEvent
      ? ethers.AbiCoder.defaultAbiCoder()
          .decode(["uint256"], mintedEvent.topics[1])[0]
          .toString()
      : "unknown";

    const explorerBase =
      this.chainId === 84532
        ? "https://sepolia.basescan.org"
        : "https://basescan.org";

    return {
      tokenId,
      transactionHash: receipt.hash,
      explorerUrl: `${explorerBase}/tx/${receipt.hash}`,
      tokenURI,
      tokenType: TokenType[intent.tokenType],
      soulbound: intent.soulbound,
    };
  }

  async totalMinted(): Promise<string> {
    const total = await this.contract.totalMinted();
    return total.toString();
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add mcp/src/minter.ts mcp/.env.example
git commit -m "feat: minting service with Base transaction handling"
```

---

### Task 8: MCP Server Entry Point

**Files:**
- Create: `mcp/src/index.ts`

Single tool: `mint`. Accepts natural language OR structured params. Classifier only fires when structured params are absent. Agents that know what they want skip NLP entirely.

- [ ] **Step 1: Create index.ts**

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import dotenv from "dotenv";
import { classifyIntent } from "./classifier.js";
import { Minter } from "./minter.js";
import { TokenType, MintIntent } from "./types.js";

dotenv.config();

const server = new McpServer({
  name: "agent-mint",
  version: "0.1.0",
});

const minter = new Minter(
  process.env.BASE_SEPOLIA_RPC_URL!,
  process.env.SERVICE_PRIVATE_KEY!,
  process.env.MINT_FACTORY_ADDRESS!,
  parseInt(process.env.CHAIN_ID || "84532")
);

server.tool(
  "mint",
  "Mint an on-chain token. Two modes: (1) Natural language: describe what you want. (2) Structured: pass tokenType, soulbound, recipient directly. If structured params are provided, the classifier is skipped.",
  {
    description: z
      .string()
      .describe(
        "What to mint. Natural language or a short label. Include recipient address (0x...) if not using the recipient param."
      ),
    recipient: z
      .string()
      .optional()
      .describe("Recipient wallet address (0x...)."),
    tokenType: z
      .enum(["identity", "attestation", "credential", "receipt", "access_pass"])
      .optional()
      .describe(
        "Token type. If provided with soulbound, skips LLM classification."
      ),
    soulbound: z
      .boolean()
      .optional()
      .describe("Whether the token is non-transferable."),
  },
  async ({ description, recipient, tokenType, soulbound }) => {
    try {
      const fallbackRecipient =
        recipient || process.env.DEFAULT_RECIPIENT || minter["wallet"].address;

      let intent: MintIntent;

      if (tokenType !== undefined) {
        // Structured path: skip classifier
        const typeMap: Record<string, TokenType> = {
          identity: TokenType.Identity,
          attestation: TokenType.Attestation,
          credential: TokenType.Credential,
          receipt: TokenType.Receipt,
          access_pass: TokenType.AccessPass,
        };
        const resolvedType = typeMap[tokenType];
        const defaultSoulbound = [
          TokenType.Attestation,
          TokenType.Credential,
          TokenType.Receipt,
        ].includes(resolvedType);

        intent = {
          tokenType: resolvedType,
          soulbound: soulbound ?? defaultSoulbound,
          recipient: fallbackRecipient,
          metadata: {
            name: description,
            description,
            attributes: {
              tokenType: TokenType[resolvedType],
              soulbound: String(soulbound ?? defaultSoulbound),
              mintedBy: "agent-mint-service",
            },
          },
        };
      } else {
        // Natural language path: classify via Haiku
        intent = await classifyIntent(description, fallbackRecipient);
      }

      const result = await minter.mint(intent);

      return {
        content: [
          {
            type: "text" as const,
            text: [
              `Minted ${result.tokenType} token #${result.tokenId}`,
              `Soulbound: ${result.soulbound}`,
              `TX: ${result.explorerUrl}`,
              `Token URI: ${result.tokenURI}`,
            ].join("\n"),
          },
        ],
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text" as const, text: `Mint failed: ${msg}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "mint_status",
  "Check how many tokens have been minted by this service",
  {},
  async () => {
    const total = await minter.totalMinted();
    return {
      content: [
        { type: "text" as const, text: `Total tokens minted: ${total}` },
      ],
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
```

- [ ] **Step 2: Install zod dependency**

```bash
cd ~/Projects/agent-mint/mcp && npm install zod
```

- [ ] **Step 3: Verify it builds**

```bash
cd ~/Projects/agent-mint/mcp && npx tsc --noEmit
```

Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add mcp/src/index.ts
git commit -m "feat: MCP server with mint and mint_status tools"
```

---

### Task 9: MCP Config and Integration Test

**Files:**
- Create: `mcp/mcp-config.json` (example config for Claude Code / other clients)
- Modify: `mcp/src/index.ts` (if needed after testing)

- [ ] **Step 1: Create example MCP config**

```json
{
  "mcpServers": {
    "agent-mint": {
      "command": "npx",
      "args": ["tsx", "src/index.ts"],
      "cwd": "/path/to/agent-mint/mcp",
      "env": {
        "BASE_SEPOLIA_RPC_URL": "",
        "SERVICE_PRIVATE_KEY": "",
        "MINT_FACTORY_ADDRESS": "",
        "CHAIN_ID": "84532"
      }
    }
  }
}
```

- [ ] **Step 2: Test the classifier locally**

Create a quick test script `mcp/test-classifier.ts`:
```typescript
import { classifyIntent } from "./src/classifier.js";

const tests = [
  "Mint an identity token for myself at 0x1234567890abcdef1234567890abcdef12345678",
  "Mint a proof that I completed the data analysis task for agent 0xABCDEF1234567890ABCDEF1234567890ABCDEF12",
  "Mint a soulbound credential proving I passed the security evaluation",
  "Mint a receipt for the 0.50 USDC payment to 0xDEADBEEF1234567890ABCDEF1234567890DEADBEEF",
  "Mint an access pass for the premium API tier",
];

for (const input of tests) {
  const result = classifyIntent(input, "0x0000000000000000000000000000000000000000");
  console.log(`\nInput: "${input}"`);
  console.log(`  Type: ${result.tokenType} (${["Identity","Attestation","Credential","Receipt","AccessPass"][result.tokenType]})`);
  console.log(`  Soulbound: ${result.soulbound}`);
  console.log(`  Recipient: ${result.recipient}`);
}
```

Run: `cd ~/Projects/agent-mint/mcp && npx tsx test-classifier.ts`
Expected: Each input correctly classified to its token type.

- [ ] **Step 3: Clean up test file and commit**

```bash
rm ~/Projects/agent-mint/mcp/test-classifier.ts
git add mcp/mcp-config.json
git commit -m "feat: mcp config example and classifier validation"
```

---

## Chunk 3: Ship It

### Task 10: README and Listing

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write README**

Minimal README with: what it is, one-liner install, example usage, deployed contract address. Keep it under 50 lines. Focus on the `mint` tool description and example inputs.

- [ ] **Step 2: Final commit**

```bash
git add README.md
git commit -m "docs: readme with usage examples"
```

- [ ] **Step 3: Create GitHub repo and push**

```bash
cd ~/Projects/agent-mint
gh repo create agent-mint --public --source=. --push
```

- [ ] **Step 4: List on directories**

Submit to:
- Glama (https://glama.ai/mcp/servers)
- MCP.so
- OpenClaw registry

---

## Post-MVP Backlog (not in this plan)

- x402 payment integration (pay-per-mint via HTTP 402, price includes gas margin)
- ERC-8004 agent card metadata format compliance (requires resolvable URI)
- EAS attestation integration (instead of vanilla ERC-721 for attestations)
- IPFS metadata storage (replace data URIs via setTokenURI migration)
- HTTP API alongside MCP (Express/Hono with x402 middleware)
- Metadata endpoint: serve token metadata from mint.day/token/{id} for ERC-8004 compatibility
- Base mainnet deployment
- Docs site / landing page ("The agent never had to know.")
