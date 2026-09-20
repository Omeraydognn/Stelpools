# Stelpools — Project Summary

**Stelpools is an on-chain liquidity pool for the Turkish lira.** Every lira you
deposit arrives in your own wallet as a digital lira, one for one; the pool
turns it into dollars; and the rate follows how much lira and how much dollar
the pool is holding, rather than a number anyone publishes.

It is two components that deliberately cannot do each other's job. A
purpose-built **SEP-6 anchor** is the only part that touches a bank: it issues
`aTRY` against Turkish lira and destroys it when lira leaves. A **constant-
product AMM on Soroban** is the only part that touches a price, and it does not
quote one — the rate is the ratio of its two reserves and moves only because
somebody traded. There is no oracle, no relay, no admin key and nothing settled
off-chain.

Live on Stellar testnet: **[stelpools.vercel.app](https://stelpools.vercel.app)**

---

## The problem

Turning Turkish lira into on-chain dollars runs into four separate frictions,
and today's answers solve at most one of them each.

- **The centralized exchange is the only real door.** KYC, withdrawal limits,
  freeze risk, and full custody handed over. Until you withdraw to your own
  wallet, the balance is an entry on somebody else's ledger.
- **P2P boards move the problem rather than solving it.** Finding a
  counterparty, agreeing a price and trusting them to release are all pushed
  onto the user, and disputes are resolved by hand.
- **Somebody always has to be trusted with the rate.** An oracle-priced or
  quote-driven gateway is exactly as honest as whoever sets the number, and
  there is no way for a user to check it or to see who moved it.
- **The capital behind the conversion is unpaid.** Whoever funds the float
  earns nothing verifiable, so there is no reason for liquidity to show up.

## The solution

Split the system so that no component can do the other's job, and hand the
price to arithmetic.

**The anchor owns the lira, and nothing else.** Send it 1,000 TRY and it issues
exactly 1,000 `aTRY` to your wallet. There is no rate on that leg, so there is
nothing to argue about and nothing to manipulate. Withdrawing sends the token
back to its issuer, which destroys it — on Stellar, an asset returned to its
issuer ceases to exist. The consequence is that the circulating supply of
`aTRY` is, by construction, the lira taken in and not yet paid back, and anyone
can read that number off Horizon without asking us.

**The pool owns the price, and nobody owns the pool.** `USDC ⇄ aTRY` is a
constant-product market: `x · y = k`. The rate is the ratio of the reserves. No
oracle feeds it, no admin sets it, and it moves only because somebody traded.

**There is no counterparty to find.** The pool is the other side of every
trade, always.

**Providers are paid in the open.** Every swap leaves 30 bps of its input in
the reserves, which is why `k` only grows. LP positions are SEP-41 tokens, so
they transfer like any other asset.

---

## How it works

### Bringing lira in

1. The browser signs a **SEP-10** challenge and receives a JWT. No password, no
   account.
2. **SEP-12** records the customer's IBAN — the anchor pays withdrawals to the
   IBAN on record, so it has to exist before a withdrawal is opened.
3. **SEP-6 deposit** returns the anchor's IBAN and a short reference such as
   `STP-4KD2-9XQM`, which the user quotes in the bank transfer description.
4. When the transfer is confirmed, the anchor's payout worker issues `aTRY`
   1:1 and the tokens land in the user's own wallet.

### Swapping

The interface calls `get_amount_out` **as a simulation against the live
contract**, not as a local re-computation, so the number on screen is the
number the swap produces. The user then signs one call — `swap(trader,
token_in, amount_in, min_out)` — straight to the contract. `min_out` is
enforced on-chain, so a price that moved between signing and landing is
refused rather than silently accepted.

### Taking lira out

The user sends `aTRY` back to the issuer with the memo the withdrawal handed
out. The tokens burn on arrival, the anchor matches the payment by that memo,
and the lira goes to the IBAN on record.

---

## The pool, in detail

| | |
| --- | --- |
| Contract | [`CBX67JY3…AZTT`](https://stellar.expert/explorer/testnet/contract/CBX67JY3W2MRZZVT4KJKE6BQUAYME6WK6HZ74LDQP7O46QHUPWFAAZTT) |
| Pair | USDC [`CBIELTK6…DAMA`](https://stellar.expert/explorer/testnet/contract/CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA) · aTRY [`CAGYYM64…H3XY`](https://stellar.expert/explorer/testnet/contract/CAGYYM64VUOMBTYPFTASJLPCEE4ERZ65SDRP2YSOCAJBYTDPU6THH3XY) |
| Fee | 30 bps, fixed at deployment |
| LP token | `spLP` — "Stelpools USDC/aTRY LP", SEP-41, 7 decimals |
| Language | Rust · `soroban-sdk 28.0.0` · `wasm32v1-none` |

```text
swap      out = (in × (10000 − fee_bps) × reserve_out)
                ────────────────────────────────────────────
                (reserve_in × 10000) + in × (10000 − fee_bps)

deposit   first provider   shares = √(a × b) − LOCKED_SHARES
          everyone after   shares = min(a × supply / reserve_a,
                                        b × supply / reserve_b)

withdraw  a = shares × reserve_a / supply      (always the current ratio)
          b = shares × reserve_b / supply
```

Two design decisions are worth calling out.

**`LOCKED_SHARES = 1000`** is Uniswap's `MINIMUM_LIQUIDITY`: minted to the
contract itself and never redeemable. Without it the pool could be drained to a
single unit and its share price inflated by donation.

**Reserves are tracked in storage rather than read from token balances.**
Sending tokens straight to the contract therefore cannot push the price.
Anything that does arrive that way is folded in by `sync()`, where it lifts
every provider equally.

### The pool has no owner

There is no `set_fee`, no `set_admin`, no `pause`, no allowlist and no upgrade
path. After the constructor ran, the only calls that can change this contract's
state are `add_liquidity`, `remove_liquidity`, `swap` and `sync` — and every
one of them is open to anybody. The fee was fixed at deployment and cannot be
changed by us or anyone else.

---

## The anchor, in detail

The anchor exists in the shape it does because of a failure we watched happen
in a third-party anchor we first integrated with: its HTTP surface stayed
perfectly healthy — accepting deposits, reporting `ok`, advancing
transactions — while the process that submits payments had quietly died. Money
went in and nothing came out, for hours, against a funded treasury.

So this one is built to be the opposite of that.

| The failure mode | What prevents it here |
| --- | --- |
| Work held in memory, lost on restart | Every job is a row in Postgres before it is acknowledged |
| The same deposit paid twice | Jobs are claimed by an atomic conditional `UPDATE`; the loser does nothing |
| A crash between submitting and recording | Each payout carries its id as a memo, so recovery asks the chain instead of guessing |
| Silent permanent failure | Attempts are counted and backed off exponentially; exhaustion is reported, not swallowed |
| A job nobody is polling for | The poll that *is* watching turns the crank, with `POST /worker/tick` as the backstop |
| "The API is up" read as "the anchor works" | `/health` is 503 unless the payout side is genuinely fine **and** the database is reached |

Standards implemented: **SEP-1** (`stellar.toml`), **SEP-6** (deposit and
withdrawal), **SEP-10** (authentication), **SEP-12** (customer/IBAN records),
and **SEP-41** for the LP token on the contract side.

Two keys, deliberately separate: a SEP-10 signing key that holds no funds, and
the `aTRY` issuer. The configuration refuses to start if they are the same,
because one key doing both would let a login challenge double as a payment
authorisation.

---

## What is already live and verified

| Step | Result |
| --- | --- |
| Bank transfer → `aTRY` | 1,000 TRY → 1,000 aTRY in **7 s** |
| No trustline on the destination | Parks in `pending_trust`, completes **by itself** once the trustline appears |
| The same transfer reported five times | One payment, four `409`s — balance 700, not 3,500 |
| Another account's transaction | `404`; without a token, `401` |
| Withdrawal | `aTRY` returned to the issuer is burned, supply reconciles exactly; settled in **2.1 s** |
| `aTRY → USDC` swap, user-signed | Quote **matched execution to the stroop** |
| `USDC → aTRY` swap | Both directions, fee retained, `k` grew |

**Tests:** 26 contract tests, 32 anchor tests. Named for the behaviour they
pin rather than the function they call — `a_bigger_trade_gets_a_worse_rate`,
`the_product_never_falls`, `a_donation_belongs_to_every_provider_once_it_is_synced`,
`a_job_can_only_be_claimed_once`, `alg_none_does_not_get_in`.

**Pool at the time of writing:** 5,429 USDC / 253,549 aTRY, 1 USDC ≈ 46.70
aTRY. A 1,000 TRY swap costs 0.69% all-in; a 10,000 TRY swap costs 4.07%. That
is the curve doing what it is supposed to, and the interface shows it before
you sign. Roughly $30k of depth would put a 10,000 TRY swap under 1%.

---

## Technology

| Layer | Directory | Stack |
| --- | --- | --- |
| AMM | `contracts/amm/` | Rust · `soroban-sdk 28.0.0` · `wasm32v1-none` |
| LP token | `contracts/amm/src/token_impl.rs` | SEP-41 · `spLP` · 7 decimals |
| Anchor | `services/anchor/` | Node 22 · Express 5 · Postgres (`pg`) · Zod · Pino |
| Interface | `web/` | React 19 · Vite 8 · TypeScript 6 · Tailwind v4 |
| Wallet | `web/src/lib/wallet.ts` | `@creit.tech/stellar-wallets-kit` |

Notable implementation details: pool state is read out of the contract's
instance storage with a single `getLedgerEntries` call rather than five
simulated view calls — measured, 10 round trips down to 1. The interface is
bilingual (English default, Turkish), with number, percent and date formatting
following the language while amount parsing accepts either convention, so
switching languages never changes what a half-typed number means.

---

## What still requires trust

Stated plainly, because a summary that claims none is not being honest.

- **The anchor is trusted with the lira.** `aTRY` is worth a lira because the
  anchor is holding one. The chain can prove how many tokens exist; it cannot
  prove the bank balance behind them. That is the same trust any fiat-backed
  token asks for, and it is why the supply is published rather than asserted.
- **The issuer key can mint.** That is what issuing means. It cannot touch the
  pool, change a price, or move anyone else's tokens.
- **Testnet.** No real money moves, the bank leg stands behind a config flag
  that is off wherever real money could be involved, and nothing has been
  audited.

## What comes next

1. **A real bank feed.** Replace the one simulated endpoint with a bank
   account-movements API, matched by the reference in the transfer
   description. Nothing else in the system changes — not the contract, not the
   interface.
2. **Proof of reserve.** The token supply is already on-chain; publishing a
   signed bank statement against it would close the one gap that still asks
   for trust.
3. **More pairs.** The AMM is generic in its two tokens; EUR and GBP pools are
   the same contract with a different pair.
4. **Deeper liquidity.** Price impact is the honest cost of a thin pool. It
   falls as the pool grows and nothing else needs to change.
5. **Audit, then mainnet.**

---

## Addresses

| | |
| --- | --- |
| Pool (AMM) | `CBX67JY3W2MRZZVT4KJKE6BQUAYME6WK6HZ74LDQP7O46QHUPWFAAZTT` |
| USDC (SAC) | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` |
| aTRY (SAC) | `CAGYYM64VUOMBTYPFTASJLPCEE4ERZ65SDRP2YSOCAJBYTDPU6THH3XY` |
| aTRY issuer | `GA6OU57WZIIU47TT56FTNMIYL574WMJ6MDHSS3ION65GTTXLTX2VPUHS` |
| Anchor | `https://anchor-bice-sigma.vercel.app` |
| App | `https://stelpools.vercel.app` |
| Network | Stellar testnet, protocol 28 |
| Licence | MIT |
