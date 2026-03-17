<div align="center">
  <img src="site/assets/logo.png" alt="mint.day" width="80" />
  <h1>mint.day</h1>
  <p><strong>Free NFT minting for agents. On Base.</strong></p>
  <p>Tell your agent what to mint. It lands on-chain in seconds.<br/>No wallet. No gas. No code.</p>

  [![npm](https://img.shields.io/npm/v/mint-day?color=2db87a&label=npm)](https://www.npmjs.com/package/mint-day)
  [![license](https://img.shields.io/badge/license-MIT-2db87a)](LICENSE)
  [![network](https://img.shields.io/badge/network-Base-0052FF)](https://basescan.org/address/0x12a1c11a0b2860f64e7d8df20989f97d40de7f2c)
  [![live](https://img.shields.io/badge/live-mint.day-e5a030)](https://mint.day)
</div>

---

<img src="site/assets/screenshot-home.png" alt="mint.day homepage" width="100%" />

## What is mint.day?

mint.day is an MCP server that gives any AI agent the ability to mint permanent, verifiable NFTs on Base. Identity cards, attestations, credentials, receipts, access passes — or any custom token you can describe in plain language.

Gas is sponsored. Wallets are optional. It works whether you are a seasoned Solidity developer or someone who just discovered Claude Code last month.

---

## Get started in 60 seconds

### Option A: You use Claude Code, Cursor, Windsurf, or any MCP client

Copy this prompt and paste it into your AI assistant:

```
Install mint.day for me.

mint.day is an MCP server that lets you mint NFTs on Base with natural language.
Identity, attestations, credentials, receipts, access passes, and visual tokens with images.

Add this MCP config:

{
  "mcpServers": {
    "mint-day": {
      "command": "npx",
      "args": ["mint-day"]
    }
  }
}

That's it. No API keys. No wallet. Gas is sponsored. Just tell me what to mint.
```

Your assistant will handle the rest.

### Option B: Add it manually

Drop this into your MCP config file (`~/.cursor/mcp.json`, `claude_desktop_config.json`, etc.):

```json
{
  "mcpServers": {
    "mint-day": {
      "command": "npx",
      "args": ["-y", "mint-day"]
    }
  }
}
```

Restart your AI client. Done.

### Option C: npm package

```bash
npm install mint-day
```

```ts
import { encodeMetadata } from 'mint-day';

const tokenURI = encodeMetadata({
  name: "Audit complete: Protocol XYZ",
  tokenType: "Attestation",
  soulbound: true,
  recipient: "0xABC..."
});
```

---

## Try it now

Once installed, tell your agent anything like:

> "Proof I shipped the v2 API today"

> "Mint me an identity token with my agent name and capabilities"

> "Issue an access pass to 0xABC... for the beta"

> "Receipt for 0.1 ETH paid to 0xDEF... on March 15"

Your agent classifies the intent, builds the metadata, and returns a ready-to-sign transaction. Confirm, and it is on-chain.

---

## Live feed

<img src="site/assets/screenshot-feed.png" alt="mint.day live feed" width="100%" />

Browse all minted tokens at [mint.day/feed](https://mint.day/feed).

---

## Token types

| Type | Default | Use for |
|------|---------|---------|
| **Identity** | transferable | Agent ID card, on-chain registration, DID |
| **Attestation** | soulbound | Proof of action, task completion, audit trail |
| **Credential** | soulbound | Reputation anchor, certification, earned status |
| **Receipt** | transferable | Payment record, transaction proof between parties |
| **Pass** | transferable | API access, capability unlock, membership |

All types support `image` and `animation_url` for visual NFTs — PFPs, art, screenshots, generative visuals.

---

## MCP tools

### `mint`

Create a permanent on-chain record.

**Natural language** (agent classifies intent automatically):
```
mint({ description: "Proof I completed the security audit for 0xABC" })
```

**Structured** (skip classification):
```
mint({
  description: "Task completion attestation",
  tokenType: "Attestation",
  recipient: "0xABC...",
  soulbound: true
})
```

**With an image:**
```
mint({
  description: "My agent identity",
  tokenType: "Identity",
  image: "https://..." // or data:image/png;base64,...
})
```

Every mint returns a **preview** first. Confirm with `mintId` to execute:

```
mint({ mintId: "a3f8c1e90b2d" })
```

---

### `mint_check`

Look up tokens by address, tx hash, or get global stats.

```
mint_check({ address: "0xABC..." })    // all tokens for a wallet
mint_check({ txHash: "0x230b..." })   // specific mint
mint_check({})                         // global stats
```

---

### `mint_resolve`

Resolve an agent's on-chain identity. Returns their Identity token with ERC-8004 agent card metadata — DID, capabilities, endpoints.

```
mint_resolve({ address: "0xABC..." })
```

---

## Signing transactions

### Option A: Built-in signing (recommended)

Generate a key, fund it with a small amount of ETH on Base (gas is less than $0.01), and mint.day handles signing and submission:

```bash
mkdir -p ~/.mint-day
node -e "
  const w = require('ethers').Wallet.createRandom();
  console.log(w.privateKey);
  console.error('Address: ' + w.address);
" 2>&1 | head -1 > ~/.mint-day/credentials
chmod 600 ~/.mint-day/credentials
```

Or set `PRIVATE_KEY` in your MCP env config.

### Option B: Bring your own signer

No private key needed. mint.day returns calldata you can submit with Coinbase AgentKit, Privy, Lit Protocol, or any EVM wallet.

---

## How it works

```
Agent -> mint tool -> classifier (Groq Llama) -> metadata builder -> calldata
                                                                        |
               [if PRIVATE_KEY] sign + submit -> tx hash, explorer link |
               [if no key]      return calldata for your own signer -----|
                                                                        |
                                               MintFactory.sol on Base mainnet
```

---

## Configuration

All optional. mint.day works with zero config.

| Variable | Default | Purpose |
|----------|---------|---------|
| `PRIVATE_KEY` | `~/.mint-day/credentials` | Signs and submits transactions |
| `BASE_RPC_URL` | `https://mainnet.base.org` | RPC endpoint |
| `CHAIN_ID` | `8453` | Base Mainnet |
| `MINT_FACTORY_ADDRESS` | see below | Override contract address |
| `CLASSIFY_URL` | hosted endpoint | Intent classifier service |

---

## Contracts

| Network | Address |
|---------|---------|
| **Base Mainnet** | [`0x12a1c11a0b2860f64e7d8df20989f97d40de7f2c`](https://basescan.org/address/0x12a1c11a0b2860f64e7d8df20989f97d40de7f2c) |
| **Base Sepolia** | [`0x16e0072Eb4131106e266035E98Cfd07532B88EAa`](https://sepolia.basescan.org/address/0x16e0072Eb4131106e266035E98Cfd07532B88EAa) |

Permissionless. Anyone can call `mint()` directly without the MCP server.

---

## Development

```bash
npm install
npm run dev     # run with tsx
npm run build   # compile to dist/
npm start       # run compiled
```

---

## Links

- [mint.day](https://mint.day) — live site
- [mint.day/feed](https://mint.day/feed) — live feed of all minted tokens
- [npm](https://www.npmjs.com/package/mint-day) — npm package
- [OpenSea](https://opensea.io/collection/mintdotday) — collection
- [X](https://x.com/mintdotday) — @mintdotday

---

MIT — built by [@jordanlyall](https://x.com/jordanlyall)
