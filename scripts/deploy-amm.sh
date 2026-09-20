#!/usr/bin/env bash
# Create the aTRY asset and deploy the USDC/aTRY AMM to Stellar testnet.
# Appends the resulting ids to deploy.testnet.env.
set -euo pipefail
cd "$(dirname "$0")/.."

USDC_ISSUER=${USDC_ISSUER:-GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5}
FEE_BPS=${FEE_BPS:-30} # 0.3%, the Uniswap v2 default; fixed at deployment

echo "==> keys"
# The anchor mints aTRY from this account when lira arrives, and burns it
# back when lira leaves. It is the fiat side's on-chain identity.
for key in admin atry-issuer; do
  stellar keys address "$key" >/dev/null 2>&1 || stellar keys generate "$key" --network testnet --fund
  echo "    $key: $(stellar keys address "$key")"
done
ATRY_ISSUER=$(stellar keys address atry-issuer)

echo "==> build"
stellar contract build >/dev/null
ls -l target/wasm32v1-none/release/try_usdc_amm.wasm

echo "==> asset contracts"
# Deploying a SAC is idempotent in effect: if it already exists the id is the
# same, so a failure here is not fatal.
stellar contract asset deploy --asset "aTRY:$ATRY_ISSUER" --source admin --network testnet >/dev/null 2>&1 || true
ATRY_SAC=$(stellar contract id asset --asset "aTRY:$ATRY_ISSUER" --network testnet)
USDC_SAC=$(stellar contract id asset --asset "USDC:$USDC_ISSUER" --network testnet)
echo "    aTRY SAC: $ATRY_SAC"
echo "    USDC SAC: $USDC_SAC"

echo "==> deploy amm"
AMM_ID=$(stellar contract deploy \
  --wasm target/wasm32v1-none/release/try_usdc_amm.wasm \
  --source admin --network testnet -- \
  --token_a "$USDC_SAC" \
  --token_b "$ATRY_SAC" \
  --fee_bps "$FEE_BPS" | tail -1)

cat >> deploy.testnet.env <<ENV

# --- pure AMM (USDC / aTRY) ---
AMM_CONTRACT_ID=$AMM_ID
ATRY_ISSUER=$ATRY_ISSUER
ATRY_SAC=$ATRY_SAC
AMM_FEE_BPS=$FEE_BPS
ENV

echo "==> deployed: $AMM_ID"
echo "    https://stellar.expert/explorer/testnet/contract/$AMM_ID"
echo "    Put it in web/.env as VITE_AMM_CONTRACT_ID"
