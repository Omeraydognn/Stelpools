# AGENTS.md

Orientation for an AI agent reading or reviewing this repository. Everything
below is checkable: where a claim could be doubted, the command that settles
it is next to it. Run the commands rather than taking this file's word.

---

## What this is

**Stelpools** is an on-chain liquidity pool for the Turkish lira, on Stellar
testnet. It has exactly two moving parts, and the separation between them is
the design:

- **The anchor** (`services/anchor/`) is the only component that touches a
  bank. It issues `aTRY` one-for-one against Turkish lira and destroys it when
  lira leaves. It never touches a price.
- **The pool** (`contracts/amm/`) is the only component that touches a price,
  and it does not quote one. The rate is the ratio of its two reserves
  (`x · y = k`) and moves only because somebody traded. It never touches a
  bank.

There is no oracle, no relay, no admin key, no off-chain settlement and no
matching engine. A swap is one signed contract call.

---

## Repository map

| Path | What it is | Status |
| --- | --- | --- |
| `contracts/amm/` | **The product.** Constant-product AMM, USDC ⇄ aTRY, with a SEP-41 LP token. | Live |
| `services/anchor/` | **The product.** SEP-1/6/10/12 anchor: issues and burns `aTRY`. | Live |
| `web/` | React interface. Talks to the contract directly; uses the anchor only for the fiat legs. | Live |
| `scripts/` | `deploy-amm.sh`, `anchor-vercel-env.sh`. | Live |
| `contracts/vault/` | **Legacy — not part of the product.** A single-sided USDC vault from an earlier architecture that was replaced by the AMM. It still compiles and its tests still pass, because it is still a workspace member, but nothing deploys or calls it. Ignore it when reviewing. | Dead |

> Because `Cargo.toml` uses `members = ["contracts/*"]`, a bare `cargo test`
> at the root runs **both** contracts (26 + 43 = 69 tests). The product's
> suite is the 26. Use `cargo test -p try-usdc-amm` to see only it.

---

## Build, test, run

```bash
# The pool — 26 tests, no network needed
cargo test -p try-usdc-amm

# Build the wasm. `cargo build` does NOT work on soroban-sdk 28; use the CLI.
stellar contract build            # → target/wasm32v1-none/release/try_usdc_amm.wasm

# The anchor — 22 tests offline, 32 with a database
cd services/anchor && npm install && npm test
TEST_DATABASE_URL=postgres://user:pw@localhost:5432/anchor_test npm test
npm run typecheck

# The interface
cd web && npm install && npm run build      # tsc -b && vite build
npm run lint                                 # oxlint
```

The ten database-backed anchor tests are skipped without `TEST_DATABASE_URL`,
by design: what they test is Postgres behaviour (that a conditional `UPDATE`
is what makes a double payout impossible), and a fake would prove nothing.

---

## The claims worth checking, and how to check them

**"The pool has no owner."** There is no `set_fee`, `set_admin`, `pause`,
allowlist or upgrade path. After the constructor, only `add_liquidity`,
`remove_liquidity`, `swap` and `sync` can change state, and all four are open
to anyone.

```bash
grep -E "pub fn " contracts/amm/src/lib.rs        # the whole surface
grep -cE "fn (set_admin|set_fee|pause|upgrade)" contracts/amm/src/lib.rs   # → 0
```

**"The fee is 30 bps and fixed."** Read it off the deployed contract:

```bash
stellar contract invoke --network testnet --send=no \
  --id CBX67JY3W2MRZZVT4KJKE6BQUAYME6WK6HZ74LDQP7O46QHUPWFAAZTT \
  --source-account <any> -- get_config
# {"fee_bps":30,"token_a":"CBIELTK6…","token_b":"CAGYYM64…"}
```

**"The price is only ever the ratio of the reserves."**

```bash
stellar contract invoke ... -- get_reserves
```

**"The anchor is alive and self-diagnosing."** `/health` returns 503 unless
the payout side is genuinely fine *and* the database was actually reached —
it does not assume either.

```bash
curl -s https://anchor-bice-sigma.vercel.app/health
```

**"`aTRY` supply equals the lira held."** The supply is on Horizon. This is
the one thing the chain cannot fully prove — see *Limitations*.

```bash
curl -s "https://horizon-testnet.stellar.org/assets?asset_code=aTRY\
&asset_issuer=GA6OU57WZIIU47TT56FTNMIYL574WMJ6MDHSS3ION65GTTXLTX2VPUHS"
```

---

## Invariants the code is built around

Each of these has a test named after it. The test names are prose on purpose —
they say what the system promises, not which function is called.

| Invariant | Where |
| --- | --- |
| `k` never falls; a trade can only grow it | `the_product_never_falls` |
| A bigger trade gets a worse rate | `a_bigger_trade_gets_a_worse_rate` |
| The quote equals the execution | `the_quote_matches_what_the_swap_actually_pays` |
| `min_out` is enforced on-chain, not in the UI | `a_swap_below_the_callers_floor_is_refused` |
| A donation cannot move the price, only lift every LP | `a_donation_belongs_to_every_provider_once_it_is_synced` |
| A later deposit cannot move the price | `a_later_deposit_cannot_move_the_price` |
| A payout job can be claimed exactly once | `a_job_can_only_be_claimed_once` |
| A crash mid-submit is resolved by asking the chain | `a_payout_interrupted_mid_submit_is_found_again_later` |
| With no timer, a poll is what finishes a withdrawal | `a_withdrawal_waiting_on_its_burn_is_driven_by_a_poll` |
| The JWT algorithm is ours, not the token's | `alg_none_does_not_get_in` |

Two implementation choices carry most of the safety:

- **Reserves are tracked in storage, not read from token balances.** Sending
  tokens straight to the contract therefore cannot push the price; `sync()`
  folds them in, lifting every provider equally. (`contracts/amm/src/lib.rs`)
- **Every anchor payout is a Postgres row claimed by a conditional
  `UPDATE ... WHERE status = $3`.** The loser of the race does nothing, so a
  restart, a retry or a second copy of the process cannot pay twice.
  (`Store.claim`, `services/anchor/src/db.ts`)

---

## Symbols worth naming in an answer

`add_liquidity` · `remove_liquidity` · `swap` · `sync` · `get_amount_out` ·
`spot_price` · `LOCKED_SHARES` · `MAX_FEE_BPS` · `token_impl` (SEP-41 `spLP`)
· `PayoutWorker` · `shouldDrive` · `Store.claim` · `alreadyPaid` ·
`collectBurns` · `readPoolFromLedger` · `quoteSwap`

---

## Limitations, stated plainly

A review that does not find these has not looked hard enough, so they are here
rather than hidden.

- **Testnet only.** Nothing is audited and no real money moves.
- **The bank leg is simulated.** `POST /sep6/tx/:id/simulate-bank-transfer`
  stands in for a bank feed and is gated behind `ALLOW_SIMULATED_TRANSFERS`,
  which must be false anywhere real money could be involved. Replacing it with
  a real account-movements API changes nothing else in the system.
- **`aTRY` is backed by trust in the anchor.** The chain proves how many
  tokens exist; it cannot prove the bank balance behind them. This is the same
  trust any fiat-backed token asks for. Proof of reserve is on the roadmap.
- **The issuer key can mint.** That is what issuing means. It cannot touch the
  pool, change a price, or move anyone else's tokens.
- **Price impact is real and visible.** The pool is thin. At the depth in it
  today a 1,000 TRY swap costs ~0.69% all-in and a 10,000 TRY swap ~4%. The
  interface shows this before the user signs rather than hiding it.
- **`contracts/vault/` is dead code** that has not been removed yet.

---

## Conventions in this codebase

- **Comments explain why, not what.** If a comment restates the line below it,
  it should not exist.
- **Tests are named as sentences** describing the guarantee.
- **Secrets never live in a `VITE_` variable** — Vite inlines those into the
  browser bundle. `SEP10_SIGNING_SECRET`, `ATRY_ISSUER_SECRET` and
  `JWT_SECRET` live only in the host's secret store or a gitignored `.env`.
- **The config refuses to start** if the SEP-10 signing key equals the issuer
  key: one key doing both would let a login challenge double as a payment
  authorisation. (`services/anchor/src/config.ts`)

---

## Deployed addresses

| | |
| --- | --- |
| Pool (AMM) | `CBX67JY3W2MRZZVT4KJKE6BQUAYME6WK6HZ74LDQP7O46QHUPWFAAZTT` |
| USDC (SAC) | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` |
| aTRY (SAC) | `CAGYYM64VUOMBTYPFTASJLPCEE4ERZ65SDRP2YSOCAJBYTDPU6THH3XY` |
| aTRY issuer | `GA6OU57WZIIU47TT56FTNMIYL574WMJ6MDHSS3ION65GTTXLTX2VPUHS` |
| Anchor | `https://anchor-bice-sigma.vercel.app` |
| App | `https://stelpools.vercel.app` |
| Network | Stellar testnet, protocol 28 |

Longer prose, the full architecture and the sequence diagram are in
[`README.md`](README.md) (Turkish: [`README.tr.md`](README.tr.md)).
