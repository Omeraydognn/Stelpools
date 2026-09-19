#!/usr/bin/env bash
# Build and deploy the USDC vault to Stellar testnet.
# Writes the resulting ids to deploy.testnet.env.
set -euo pipefail
cd "$(dirname "$0")/.."

USDC_ISSUER=${USDC_ISSUER:-GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5}
WITHDRAW_FEE_BPS=${WITHDRAW_FEE_BPS:-50}   # 0.5%, stays in the vault

echo "==> keys"
for key in admin user; do
  stellar keys address "$key" >/dev/null 2>&1 || stellar keys generate "$key" --network testnet --fund
  echo "    $key: $(stellar keys address "$key")"
done

echo "==> build"
stellar contract build >/dev/null
ls -l target/wasm32v1-none/release/usdc_vault.wasm

USDC_SAC=$(stellar contract id asset --asset "USDC:$USDC_ISSUER" --network testnet)
echo "==> USDC SAC: $USDC_SAC"

echo "==> deploy"
VAULT_ID=$(stellar contract deploy \
  --wasm target/wasm32v1-none/release/usdc_vault.wasm \
  --source admin --network testnet -- \
  --admin "$(stellar keys address admin)" \
  --usdc "$USDC_SAC" \
  --withdraw_fee_bps "$WITHDRAW_FEE_BPS" | tail -1)

cat > deploy.testnet.env <<ENV
VAULT_CONTRACT_ID=$VAULT_ID
USDC_SAC=$USDC_SAC
USDC_ISSUER=$USDC_ISSUER
ADMIN=$(stellar keys address admin)
ENV

echo "==> deployed: $VAULT_ID"
echo "    https://stellar.expert/explorer/testnet/contract/$VAULT_ID"
echo "    Put it in web/.env as VITE_VAULT_CONTRACT_ID"
