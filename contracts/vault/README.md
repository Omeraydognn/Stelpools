# usdc-vault

A share-accounted USDC vault. Depositors get shares; anything that arrives
without minting shares — the withdrawal fee, a yield distribution, a
strategy's return — raises what every share is worth.

Fiat never touches this contract. Lira enters and leaves through the anchor's
SEP-6 rails, so by the time a user reaches the vault they already hold USDC.

## Functions

### Vault

| Function | Who | What |
|---|---|---|
| `deposit(from, assets) -> shares` | depositor | pulls USDC in, mints shares at the current price |
| `withdraw(from, shares) -> assets` | holder | burns shares, pays out USDC less the fee |
| `withdraw_all(from) -> assets` | holder | the whole position |
| `donate(from, assets)` | anyone | adds USDC without minting — this is how yield arrives |
| `preview_deposit` / `preview_withdraw` | anyone | exactly what the real call would do |
| `total_assets` / `total_shares` / `share_price` / `balance_of` | anyone | — |
| `set_fee` / `set_paused` / `set_deposit_cap` / `set_admin` | admin | — |

### The share is a SEP-41 token

A position that cannot move is only half a position, so shares implement the
standard token interface: `name` `symbol` `decimals` `balance` `transfer`
`approve` `allowance` `transfer_from` `burn` `burn_from`. Symbol `vUSDC`, 7
decimals.

Transfer a share and the claim on the pool goes with it — the same thing an
LP token does on other networks. `burn` destroys shares without taking the
assets out, which hands their value to everyone who stayed.

## Share maths

```
first deposit      shares = assets − LOCKED_SHARES  (price starts at 1.0)
later deposits     shares = assets × total_shares / total_assets
withdrawal         gross  = shares × total_assets / total_shares
                   payout = gross − gross × fee_bps / 10000
```

`total_assets` is the vault's own token balance, so a plain transfer into the
contract counts as yield without any bookkeeping call.

## The two guards worth knowing

**A tiny first deposit is refused** (`MIN_INITIAL_DEPOSIT`, 1 USDC). A vault
opened with a single stroop can be inflated: the opener donates a large amount
and every later deposit rounds down to zero shares. A meaningful opening
balance makes that pointless, and a deposit that would mint zero shares is
rejected outright.

**The fee is capped at 5% and pausing never blocks withdrawals.** An admin can
stop new money coming in; they cannot trap money that is already in.

## Build, test, deploy

```bash
cargo test -p usdc-vault      # 31 tests
stellar contract build

stellar contract deploy \
  --wasm target/wasm32v1-none/release/usdc_vault.wasm \
  --source admin --network testnet -- \
  --admin "$(stellar keys address admin)" \
  --usdc "$(stellar contract id asset --asset USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5 --network testnet)" \
  --withdraw_fee_bps 50 \
  --deposit_cap 0            # 0 = no cap
```

Deployed on testnet at
[`CCEAE5OSVBV63UVH26JKQ5PWXQPOHTAGL3WSDCCG2GYF23DGWM77VOV2`](https://stellar.expert/explorer/testnet/contract/CCEAE5OSVBV63UVH26JKQ5PWXQPOHTAGL3WSDCCG2GYF23DGWM77VOV2).
