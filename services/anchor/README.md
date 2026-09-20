# anchor

The fiat side. It turns Turkish lira into `aTRY` on Stellar, and back.

One `aTRY` is one lira this anchor is holding. There is no exchange rate to
argue about and no oracle to trust: a deposit of 1,000 TRY issues exactly
1,000 aTRY. The price of lira against dollars is discovered somewhere else
entirely — in the AMM, by people trading.

Issuing and burning are both just payments. The issuer paying a user brings
tokens into existence; a user paying the issuer destroys them, because an
asset returned to its issuer ceases to exist. So the amount of aTRY in the
world is, by construction, the lira taken in and not yet paid back. You can
check it yourself:

```bash
curl "https://horizon-testnet.stellar.org/assets?asset_code=aTRY&asset_issuer=<issuer>"
```

## Why this is built the way it is

We watched another anchor fail, and the shape of that failure decided this
design. Its HTTP surface stayed perfectly healthy for hours — accepting
deposits, answering `ok: true`, moving transactions to `pending_anchor` —
while the process that submits payments had quietly died. Money went in and
nothing came out, with a fully funded treasury. Nothing it reported revealed
it.

So:

| The failure | What stops it here |
|---|---|
| Work held in memory, lost on restart | Every job is a row in the ledger before it is acknowledged |
| The same deposit paid twice | A job is claimed by an atomic status change; the loser does nothing |
| A crash between submitting and recording | Each payout carries its own id as a memo, so recovery asks the chain what happened instead of guessing |
| A payment that fails forever, silently | Attempts are counted, backed off, and a job that runs out says so |
| "The API is up" mistaken for "the anchor works" | `/health` answers **503** the moment the worker stops ticking |

The last one is the important one. An anchor whose web server is fine and
whose payouts are dead is the worst version of itself, because it keeps
taking deposits it will never honour.

## The flow

**Deposit.** SEP-10 → SEP-12 → `GET /sep6/deposit` returns the anchor's IBAN
and a reference like `STP-4KD2-9XQM`. The user sends lira from their own bank
with that reference in the description. When it arrives the worker issues
aTRY to their wallet.

On testnet there is no bank, so `POST /sep6/tx/:id/simulate-bank-transfer`
stands in for it. It is behind `ALLOW_SIMULATED_TRANSFERS` and named for what
it is, because it mints tokens against money nobody sent. In production a
bank feed replaces that one call and nothing else changes.

**Withdrawal.** `GET /sep6/withdraw` returns the issuer's address and a memo.
The user sends aTRY there; the watcher matches it by memo, the tokens burn,
and the lira goes to the IBAN on their SEP-12 record. Withdrawing without a
registered IBAN is refused with the field name, not a generic error.

**No trustline?** The deposit parks in `pending_trust` and says so. The moment
the user adds the trustline the worker picks it up and completes on its own —
nothing is lost and nothing needs re-doing.

## Endpoints

| Method | Path | |
|---|---|---|
| `GET` | `/health` | worker liveness, 503 when the loop has stopped |
| `GET` | `/.well-known/stellar.toml` | SEP-1 |
| `GET` `POST` | `/auth` | SEP-10, built on the SDK's own challenge helpers |
| `PUT` `GET` | `/sep12/customer` | SEP-12 |
| `GET` | `/sep6/info` `/sep6/deposit` `/sep6/withdraw` | SEP-6 |
| `GET` | `/sep6/transaction` `/sep6/transactions` | SEP-6, scoped to the token's account |
| `POST` | `/sep6/tx/:id/simulate-bank-transfer` | testnet only |

A transaction is only ever readable by the account it belongs to: another
account's token gets a 404, no token gets a 401.

## Run

```bash
cp .env.example .env     # the three secrets, then the bank details
npm install
npm run dev              # http://localhost:8790
npm test                 # 17 offline; 10 ledger tests need TEST_DATABASE_URL
```

The three secrets are a SEP-10 signing key, a JWT secret of at least 32
characters, and the aTRY issuer key. The config refuses to load if the
signing key and the issuer key are the same.

## Deploying it

It runs as a Vercel function beside the site, with a managed Postgres for the
ledger. That needs one change from the local setup and it is worth being
straight about: **there is no process left alive between requests, so there
is no timer.** `WORKER_MODE=request` makes the requests drive the same work —
reporting a transfer and polling a transaction each turn the crank, and
`POST /worker/tick` is there for anything nobody is polling for.

None of the guarantees move. They were never in the timer: the atomic claim,
the crash recovery and the double-payout protection all live in the ledger,
which is exactly why this swap is safe. In request mode the claim is doing
more work, not less — several copies of the function can be alive at once,
and the conditional UPDATE is what keeps them from paying the same deposit
twice. There is a test for that race.

```bash
cd services/anchor
npx vercel link            # a second project, beside the web one
npx vercel storage create  # attach a Postgres store; sets POSTGRES_URL

npx vercel env add SEP10_SIGNING_SECRET production   # stellar keys show anchor-signing
npx vercel env add ATRY_ISSUER_SECRET production     # stellar keys show atry-issuer
npx vercel env add JWT_SECRET production             # openssl rand -hex 32
npx vercel env add WORKER_MODE production            # request
npx vercel env add HOME_DOMAIN production            # <your-anchor>.vercel.app
npx vercel env add PUBLIC_URL production             # https://<your-anchor>.vercel.app
npx vercel env add CORS_ORIGINS production           # https://stelpools.vercel.app
npx vercel env add ATRY_CODE production              # aTRY

npx vercel deploy --prod
curl https://<your-anchor>.vercel.app/health
```

Then point the interface at it and redeploy the site:

```
VITE_ANCHOR_URL=https://<your-anchor>.vercel.app
VITE_ANCHOR_HOME_DOMAIN=<your-anchor>.vercel.app
```

`HOME_DOMAIN` must match `VITE_ANCHOR_HOME_DOMAIN` exactly. The domain is
signed into every SEP-10 challenge, so a mismatch rejects every login with an
error that does not mention domains at all.
