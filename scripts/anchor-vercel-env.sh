#!/usr/bin/env bash
# Print the environment block for the anchor's Vercel project.
#
# Vercel's environment-variables screen takes a pasted .env, so this exists
# to assemble one from the keys already in your stellar keystore instead of
# copying three secrets by hand and getting one of them subtly wrong.
#
#   ./scripts/anchor-vercel-env.sh stelpools-anchor.vercel.app
#
# The output contains real secret keys. Paste it into Vercel and nowhere
# else: not a chat, not a screenshot, not the repository.
set -euo pipefail

DOMAIN=${1:-}
if [ -z "$DOMAIN" ]; then
  echo "usage: $0 <anchor-domain>            e.g. stelpools-anchor.vercel.app" >&2
  echo >&2
  echo "The domain is the one Vercel gives the anchor project. It has to match" >&2
  echo "VITE_ANCHOR_HOME_DOMAIN in the web project exactly: the domain is signed" >&2
  echo "into every SEP-10 challenge, so a mismatch rejects every login." >&2
  exit 1
fi
DOMAIN=${DOMAIN#https://}
DOMAIN=${DOMAIN%/}

for key in anchor-signing atry-issuer; do
  stellar keys address "$key" >/dev/null 2>&1 || {
    echo "missing key '$key' in the stellar keystore." >&2
    echo "Create it with: stellar keys generate $key --network testnet" >&2
    exit 1
  }
done

SITE=${SITE_ORIGIN:-https://stelpools.vercel.app}

cat <<ENV
# ─────────────────────────────────────────────────────────────────────────
# Stelpools anchor — paste this into the ANCHOR project on Vercel
# (Settings → Environment Variables → paste .env)
#
# POSTGRES_URL is NOT here: attaching a Postgres store from the Storage tab
# sets it for you, and the anchor reads it automatically.
# ─────────────────────────────────────────────────────────────────────────

# No process survives between requests on Vercel, so the requests drive the
# payout work instead of a timer.
WORKER_MODE=request

# Must match VITE_ANCHOR_HOME_DOMAIN in the web project, exactly.
HOME_DOMAIN=$DOMAIN
PUBLIC_URL=https://$DOMAIN
CORS_ORIGINS=$SITE

NETWORK_PASSPHRASE=Test SDF Network ; September 2015
HORIZON_URL=https://horizon-testnet.stellar.org
ATRY_CODE=aTRY

SEP10_SIGNING_SECRET=$(stellar keys show anchor-signing)
ATRY_ISSUER_SECRET=$(stellar keys show atry-issuer)
JWT_SECRET=$(openssl rand -hex 32)

BANK_NAME=Stelpools Test Bank A.Ş.
BANK_IBAN=TR000000000000000000000001
BANK_ACCOUNT_HOLDER=Stelpools Teknoloji A.Ş.

FEE_BPS=0
MIN_DEPOSIT_TRY=50
MAX_DEPOSIT_TRY=50000
MAX_PAYOUT_ATTEMPTS=8

# Testnet only: no real bank exists, so the transfer is reported by hand.
ALLOW_SIMULATED_TRANSFERS=true
LOG_LEVEL=info
ENV

cat >&2 <<NOTE

─────────────────────────────────────────────────────────────────────────
Then, in the WEB project on Vercel:

  VITE_ANCHOR_URL=https://$DOMAIN
  VITE_ANCHOR_HOME_DOMAIN=$DOMAIN

and redeploy it. Both projects have to be redeployed for the change to
reach the browser bundle.
─────────────────────────────────────────────────────────────────────────
NOTE
