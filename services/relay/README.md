# relay

The settlement watcher behind instant fills.

When somebody sends lira to the anchor, the anchor owes them USDC but does not
deliver it immediately — minutes on a real bank rail. The relay reads the
anchor's own record of that deposit and, if it checks out, tells the vault to
pay the person now. The vault is repaid when the anchor's USDC arrives.

## What it can and cannot do

The relay holds a key whose **only** power is `open_advance`. It cannot move
the pool's USDC anywhere else, cannot change fees, cannot pause anything. Its
reach is bounded by limits the vault's admin sets on-chain:

| Limit | Where |
|---|---|
| Largest single advance | `max_advance` on the vault |
| Total outstanding at once | `advance_cap` on the vault |
| A second, tighter ceiling | `MAX_ADVANCE_USDC` here |
| One open advance per account | enforced by the vault |

**This is a trusted component, and the trust is real.** The vault is unsecured
between paying out and being repaid: nothing on-chain forces the borrower to
hand the anchor's USDC back. That is why the limits are small, why a defaulted
advance is written off in the open — the loss lands on the share price where
everyone can see it — and why the relay refuses anything it cannot verify from
the anchor's own record.

## What it checks before fronting

1. The SEP-10 token identifies the account asking.
2. The anchor has a deposit with that id, for that account.
3. The anchor is already on the hook for it — not `incomplete`, `error`,
   `refunded` or `expired`.
4. The anchor has quoted a USDC amount, and it is within both ceilings.
5. That account has no advance open already.

See [`src/eligibility.ts`](src/eligibility.ts); the rules are pure functions
and the tests cover each refusal.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | relay address, vault liquidity, outstanding advances |
| `POST` | `/advance` | `{ jwt, transaction_id }` → the vault pays out now |
| `GET` | `/advance/:account` | what that account still owes |

Repayment is not here: it is the borrower's own signature on
`repay_advance`, straight from the interface.

## Run

```bash
cp .env.example .env     # VAULT_CONTRACT_ID and RELAY_SECRET_KEY
npm install
npm run dev              # http://localhost:8788
npm test                 # 8 tests, no network
```

Without this service running the interface simply hides the instant-fill
option; every other flow works unchanged.
