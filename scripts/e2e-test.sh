#!/bin/bash
# E2E test: structured mint via calldata, submitted with cast
# Prerequisites: cast installed, MINT_FACTORY_ADDRESS set, test wallet funded with Sepolia ETH
set -e

# --- Config ---
RPC_URL="${BASE_SEPOLIA_RPC_URL:-https://sepolia.base.org}"
FACTORY="${MINT_FACTORY_ADDRESS:?Set MINT_FACTORY_ADDRESS}"
TEST_KEY="${TEST_PRIVATE_KEY:?Set TEST_PRIVATE_KEY}"
TEST_WALLET=$(cast wallet address "$TEST_KEY")

echo "=== mint.day E2E Test ==="
echo "Factory:  $FACTORY"
echo "Wallet:   $TEST_WALLET"
echo "Chain:    Base Sepolia"
echo ""

# --- 1. Check current mint count ---
BEFORE=$(cast call "$FACTORY" "totalMinted()(uint256)" --rpc-url "$RPC_URL")
echo "Tokens before: $BEFORE"

# --- 2. Check mint fee ---
FEE=$(cast call "$FACTORY" "mintFee()(uint256)" --rpc-url "$RPC_URL")
echo "Mint fee: $FEE wei"

# --- 3. Build metadata (base64 data URI) ---
METADATA='{"name":"mint.day E2E Test","description":"First E2E test token","tokenType":"Attestation","soulbound":true,"creator":"'$TEST_WALLET'","recipient":"'$TEST_WALLET'","timestamp":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'","chainId":84532,"mintday_version":"1"}'
TOKEN_URI="data:application/json;base64,$(echo -n "$METADATA" | base64)"

# --- 4. Mint an Attestation (type=1, soulbound=true) ---
echo ""
echo "Minting Attestation token..."
TX_HASH=$(cast send "$FACTORY" \
  "mint(address,string,uint8,bool)" \
  "$TEST_WALLET" "$TOKEN_URI" 1 true \
  --value "$FEE" \
  --private-key "$TEST_KEY" \
  --rpc-url "$RPC_URL" \
  --json | jq -r '.transactionHash')

echo "TX: $TX_HASH"
echo "Explorer: https://sepolia.basescan.org/tx/$TX_HASH"

# --- 5. Wait for confirmation, then verify ---
sleep 5
AFTER=$(cast call "$FACTORY" "totalMinted()(uint256)" --rpc-url "$RPC_URL")
echo ""
echo "Tokens after: $AFTER"

if [ "$AFTER" -gt "$BEFORE" ]; then
  TOKEN_ID=$AFTER
  OWNER=$(cast call "$FACTORY" "ownerOf(uint256)(address)" "$TOKEN_ID" --rpc-url "$RPC_URL")
  echo "Token #$TOKEN_ID owner: $OWNER"

  # Check soulbound flag
  TDATA=$(cast call "$FACTORY" "tokenData(uint256)(uint8,bool,uint256)" "$TOKEN_ID" --rpc-url "$RPC_URL")
  echo "Token data: $TDATA"

  echo ""
  echo "=== E2E PASS ==="
else
  echo "=== E2E FAIL: token count did not increase ==="
  exit 1
fi
