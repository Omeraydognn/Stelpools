# web

The pool interface. One screen: stats across the top, the share-price chart
and your position on the left, and three tabs on the right — swap, deposit,
withdraw.

React + Vite + TypeScript + Tailwind v4, with the primitives in
[`src/components/ui.tsx`](src/components/ui.tsx) and every colour coming from
[`brand.md`](../brand.md).

**No backend.** The app talks to the anchor, Soroban RPC and Horizon directly.

## Run

```bash
cp .env.example .env     # VITE_VAULT_CONTRACT_ID and the anchor
npm install
npm run dev              # http://localhost:5173
```

## The three flows

**Swap — TRY ⇄ USDC.** Straight over the anchor's rails, in two steps,
because the middle one belongs to the user's bank:

1. *Yatırma talimatı al* — SEP-10, SEP-12, then `POST /sep6/deposit`. The
   anchor answers with its own IBAN and a reference code.
2. The user sends the lira from their bank to that IBAN with the code in the
   description. The anchor matches the transfer by that code. On testnet
   there is a clearly-labelled sandbox button that records the transfer
   instead; in production it is not there.
3. The anchor delivers USDC to the wallet — or, with *Anında al*, the pool
   pays immediately and is repaid when the anchor settles.

Going the other way needs an IBAN: it is registered with SEP-12, the USDC
goes to the anchor's treasury with the memo it returned, and the anchor pays
lira out.

The anchor is the counterparty for lira, not the vault — nothing on-chain can
hold a bank balance.

## The vault flows

**In — TRY → vault.** SEP-10 → SEP-12 → `POST /sep6/deposit` → the bank leg
(simulated in the sandbox, a real FAST transfer against a live anchor) → the
anchor sends USDC to the wallet → `deposit()` mints shares. One button, with
each step named as it happens.

**Out — vault → TRY.** `withdraw()` burns shares and pays USDC to the wallet.
Tick "TRY olarak gönder" and it continues: SEP-12 with the IBAN →
`GET /sep6/withdraw` → a USDC payment to the anchor's treasury carrying the
memo it returned → the anchor pays lira to that IBAN.

Withdrawing to the wallet and cashing out are separate signatures, and the
second one is optional — the user can stop holding USDC.

## Pool information

Below the chart, the same panel a pool page usually carries — built from what
this vault actually has:

* **Likidite kullanımı** — how much of the pool is out on advance rather than
  sitting idle. This is a real utilisation figure, not a placeholder.
* **Bileşim** — a single asset, split into what is in hand and what is
  advanced.
* **Getiri kaynakları** — measured APR, plus the exit and advance fees that
  produce it.
* **Kontratlar** — vault (which is also the share token), USDC SAC, admin,
  relay, price source, network. Every address links to the explorer.
* **Hacim ve kazanç** — turnover, and the exit and advance fees the pool has
  actually earned. An advance fee only counts once that advance is seen to be
  repaid in full.
* **Parametreler** — share price, shares outstanding, caps, and whether
  deposits are paused.
* **Riskler** — unsecured advances, the trusted relay, what the admin can and
  cannot do, and what happens to withdrawals at high utilisation.

Under it, **Havuz hareketleri** lists every deposit, withdrawal, advance,
repayment and write-off from the contract's own events, each linking to the
transaction. None of the figures above have to be taken on trust.

An AMM's amplification factor or a staking gauge would be meaningless in a
single-asset vault, so those rows say so instead of showing a number.

## What the screen tells you

| | |
|---|---|
| TVL | the vault's USDC balance, and its TRY value at the anchor rate |
| Pay fiyatı | USDC per share — it starts at 1.0 and only rises |
| Çıkış komisyonu | taken on withdrawal and left in the vault, so it accrues to whoever stayed |
| Pozisyonunuz | your shares, what they are worth today, and in lira |

Before anything is signed the app checks the wallet: account exists, USDC
trustline present, enough XLM for fees. Missing pieces are named, with a
button to fix the ones the app can fix.

## Conventions

* Every number is `.tnum` (DM Mono + `tabular-nums`) and formatted `tr-TR`.
* Contract error codes are translated into Turkish sentences in
  [`src/lib/vault.ts`](src/lib/vault.ts); nobody reads `Error(Contract, #21)`.
* Transactions are simulated before the wallet prompt, so a user is never
  asked to sign something that was always going to fail.
* Loading, empty and error states exist for every fetch.
