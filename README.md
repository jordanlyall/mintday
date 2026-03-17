# mint.day

Agents mint NFTs now.

## Quick start

**1. Install** (zero config)

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

Works with Claude Code, Cursor, Windsurf, OpenClaw, and any MCP client.

**2. Mint**

Tell your agent: "Proof I completed the security audit for 0xABC"

**3. Verify**

```
mint_check({ address: "0xABC..." })
```

That's it. Your agent classifies the intent, builds the token, and returns a ready-to-sign transaction.

## Signing transactions

mint.day can sign and submit transactions directly, or return calldata for your own signer.

### Option A: Built-in signing (recommended)

Save a private key and mint.day handles everything:

```bash
mkdir -p ~/.mint-day
node -e "const w = require('ethers').Wallet.createRandom(); console.log(w.privateKey); console.error('Address: ' + w.address)"  2>&1 | head -1 > ~/.mint-day/credentials
chmod 600 ~/.mint-day/credentials
```

Fund the address with a small amount of ETH on Base (gas is < $0.01 per mint). Restart the MCP server.

You can also set `PRIVATE_KEY` in your MCP env config instead of using the file.

### Option B: Bring your own signer

Don't set a private key. mint.day returns calldata. Submit it with Coinbase AgentKit, Lit Protocol, Privy, or any EVM wallet.

## Tools

### `mint`

Create a permanent, verifiable on-chain record on Base.

**Natural language:**

```
mint({ description: "Proof I completed the security audit for 0xABC" })
```

**Structured** (skips classification):

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
  image: "data:image/png;base64,..."
})
```

Every mint returns a preview first. Confirm with `mintId` to execute:

```
mint({ mintId: "a3f8c1e90b2d" })
```

With built-in signing, you get back a tx hash and explorer link. Without it, you get calldata.

### `mint_check`

Look up tokens by address, transaction hash, or get global stats.

```
mint_check({ address: "0xABC..." })
mint_check({ txHash: "0x230b..." })
mint_check({})  // global stats
```

### `mint_resolve`

Resolve an agent's on-chain identity. Returns their Identity token with ERC-8004 agent card metadata.

```
mint_resolve({ address: "0xABC..." })
```

## Token types

| Type | Default | Use for |
|------|---------|---------|
| Identity | transferable | Agent ID card, on-chain registration |
| Attestation | soulbound | Proof of action, task completion |
| Credential | soulbound | Reputation anchor, certification |
| Receipt | transferable | Payment record between two parties |
| Pass | transferable | API access, capability unlock |

All types support `image` and `animation_url` for visual NFTs (PFPs, art, collectibles).

## Architecture

```
Agent -> mint tool -> classifier (Groq Llama) -> metadata builder -> calldata
                                                                        |
                         [if PRIVATE_KEY] sign + submit -> tx hash <----|
                         [if no key]      return calldata <-------------|
                                                                        |
                                                        MintFactory.sol (Base)
```

## Contracts

- **Base Mainnet**: [`0xbf12d372444dcf69df9316d961439f6b5919e8d0`](https://basescan.org/address/0xbf12d372444dcf69df9316d961439f6b5919e8d0)
- **Base Sepolia**: [`0xa52450397f312c256Bd68B202C0CF90387Ea0E67`](https://sepolia.basescan.org/address/0xa52450397f312c256Bd68B202C0CF90387Ea0E67)

## Configuration

All optional. mint.day works with zero config.

| Env var | Default | Purpose |
|---------|---------|---------|
| `PRIVATE_KEY` | `~/.mint-day/credentials` | Signs and submits transactions |
| `BASE_RPC_URL` | `https://mainnet.base.org` | RPC endpoint |
| `CHAIN_ID` | `8453` | Base Mainnet |
| `MINT_FACTORY_ADDRESS` | `0xbf12d3...` | Contract address |
| `CLASSIFY_URL` | hosted endpoint | Intent classifier |

## Development

```bash
npm install
npm run dev     # run with tsx
npm run build   # compile to dist/
npm start       # run compiled
```

## License

MIT
