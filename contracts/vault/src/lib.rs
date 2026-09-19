#![no_std]
//! A share-based USDC vault for the TRY ⇄ USDC gateway.
//!
//! The vault holds pooled USDC and tracks each depositor's claim on it as
//! shares. Anything that increases the vault's balance without minting shares
//! — a withdrawal fee, a yield distribution, a strategy's return — raises the
//! value of every existing share.
//!
//! Fiat never touches this contract. Lira enters and leaves through the
//! anchor's SEP-6 rails; by the time a user reaches the vault they already
//! hold USDC.

mod errors;
mod events;
mod token_impl;
mod types;


#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, panic_with_error, token, Address, Env, String};

pub use errors::Error;
pub use types::{AdvanceRecord, Config, DataKey};

const TTL_BUMP: u32 = 518_400; // ~30 days of ledgers
const TTL_THRESHOLD: u32 = 120_960; // re-bump under ~7 days
const BPS_DENOM: i128 = 10_000;
const MAX_FEE_BPS: u32 = 500; // 5%, a hard ceiling the admin cannot exceed

/// The first deposit must be at least 1 USDC.
///
/// A vault that starts with a single stroop can be inflated: the first
/// depositor donates a large amount, and every later deposit rounds down to
/// zero shares. A meaningful opening balance makes that attack pointless.
const MIN_INITIAL_DEPOSIT: i128 = 1_0000000;

/// Shares minted to the vault itself on the first deposit and never redeemed.
///
/// Two things need this. Supply can never return to zero, so the share price
/// is always defined and the inflation attack has no empty vault to start
/// from. And the withdrawal fee always has someone to accrue to — without it,
/// the last holder to leave strands their own fee with no owner.
const LOCKED_SHARES: i128 = 1_000_000; // 0.1 share

#[contract]
pub struct Vault;

#[contractimpl]
impl Vault {
    #[allow(clippy::too_many_arguments)]
    pub fn __constructor(
        e: Env,
        admin: Address,
        usdc: Address,
        withdraw_fee_bps: u32,
        deposit_cap: i128,
        relay: Address,
        max_advance: i128,
        advance_cap: i128,
        advance_fee_bps: u32,
    ) {
        if withdraw_fee_bps > MAX_FEE_BPS || advance_fee_bps > MAX_FEE_BPS {
            panic_with_error!(&e, Error::InvalidFee);
        }
        if deposit_cap < 0 || max_advance < 0 || advance_cap < 0 {
            panic_with_error!(&e, Error::InvalidAmount);
        }
        e.storage().instance().set(
            &DataKey::Config,
            &Config {
                admin,
                usdc,
                withdraw_fee_bps,
                deposit_cap,
                relay,
                max_advance,
                advance_cap,
                advance_fee_bps,
                paused: false,
            },
        );
        e.storage().instance().set(&DataKey::TotalSupply, &0i128);
        e.storage().instance().set(&DataKey::TotalAdvanced, &0i128);
    }

    // ----------------------------------------------------------------- user

    /// Move `assets` USDC into the vault and mint the matching shares.
    pub fn deposit(e: Env, from: Address, assets: i128) -> i128 {
        from.require_auth();
        let cfg = config(&e);
        if cfg.paused {
            panic_with_error!(&e, Error::Paused);
        }
        if assets <= 0 {
            panic_with_error!(&e, Error::InvalidAmount);
        }

        let total_shares = total_shares(&e);
        // Read the balance before the transfer, or the deposit would price
        // itself into its own share calculation.
        let total_assets = total_assets(&e, &cfg);

        if cfg.deposit_cap > 0 && total_assets + assets > cfg.deposit_cap {
            panic_with_error!(&e, Error::CapExceeded);
        }

        let bootstrapping = total_shares == 0;
        let shares = if bootstrapping {
            if assets < MIN_INITIAL_DEPOSIT {
                panic_with_error!(&e, Error::BelowMinimumDeposit);
            }
            assets - LOCKED_SHARES
        } else {
            mul_div(&e, assets, total_shares, total_assets)
        };
        if shares <= 0 {
            panic_with_error!(&e, Error::DepositTooSmall);
        }

        token::Client::new(&e, &cfg.usdc).transfer(
            &from,
            &e.current_contract_address(),
            &assets,
        );

        if bootstrapping {
            // Locked in the vault's own name, permanently.
            token_impl::mint(&e, &e.current_contract_address(), LOCKED_SHARES);
        }
        token_impl::mint(&e, &from, shares);

        events::deposited(
            &e,
            &from,
            assets,
            shares,
            total_assets + assets,
            token_impl::total_supply(&e),
        );
        shares
    }

    /// Burn `shares` and pay out the USDC they are worth, less the fee.
    /// Returns the amount actually paid out.
    pub fn withdraw(e: Env, from: Address, shares: i128) -> i128 {
        from.require_auth();
        let cfg = config(&e);
        if shares <= 0 {
            panic_with_error!(&e, Error::InvalidAmount);
        }
        let held = shares_of(&e, &from);
        if shares > held {
            panic_with_error!(&e, Error::InsufficientShares);
        }

        let total_shares = total_shares(&e);
        let total_assets = total_assets(&e, &cfg);
        let gross = mul_div(&e, shares, total_assets, total_shares);
        let fee = mul_div(&e, gross, cfg.withdraw_fee_bps as i128, BPS_DENOM);
        let payout = gross - fee;
        if payout <= 0 {
            panic_with_error!(&e, Error::WithdrawTooSmall);
        }
        // Money out on advance is owed to the vault but not in its hands.
        if payout > liquid_assets(&e, &cfg) {
            panic_with_error!(&e, Error::InsufficientLiquidity);
        }

        // Burn first: the balance must not be readable as still-owned while
        // the token contract is being called.
        let _ = held;
        token_impl::burn_shares(&e, &from, shares);

        token::Client::new(&e, &cfg.usdc).transfer(
            &e.current_contract_address(),
            &from,
            &payout,
        );

        // The fee stays behind, so it accrues to whoever is still in the pool.
        events::withdrawn(
            &e,
            &from,
            payout,
            shares,
            fee,
            total_assets - payout,
            total_shares - shares,
        );
        payout
    }

    /// Withdraw everything this account holds.
    pub fn withdraw_all(e: Env, from: Address) -> i128 {
        let shares = shares_of(&e, &from);
        if shares <= 0 {
            panic_with_error!(&e, Error::InsufficientShares);
        }
        Self::withdraw(e, from, shares)
    }

    /// Add USDC without minting shares, raising every share's value.
    ///
    /// This is how yield reaches the pool — from a strategy, a rebate, or a
    /// sponsor topping it up during a demo.
    pub fn donate(e: Env, from: Address, assets: i128) {
        from.require_auth();
        let cfg = config(&e);
        if assets <= 0 {
            panic_with_error!(&e, Error::InvalidAmount);
        }
        token::Client::new(&e, &cfg.usdc).transfer(
            &from,
            &e.current_contract_address(),
            &assets,
        );
        events::donated(&e, &from, assets, total_assets(&e, &cfg), total_shares(&e));
    }

    // ------------------------------------------------------------- advances

    /// Pay a user now for USDC the anchor has accepted but not yet delivered.
    ///
    /// Only the relay may open one, because only the relay has checked the
    /// anchor's SEP-6 transaction. The vault is unsecured for the gap between
    /// this call and repayment, which is why the limits exist and why
    /// `write_off` is an ordinary, visible operation rather than a hidden one.
    pub fn open_advance(e: Env, user: Address, amount: i128) -> i128 {
        let cfg = config(&e);
        cfg.relay.require_auth();

        if cfg.max_advance == 0 {
            panic_with_error!(&e, Error::AdvancesDisabled);
        }
        if amount <= 0 {
            panic_with_error!(&e, Error::InvalidAmount);
        }
        if amount > cfg.max_advance {
            panic_with_error!(&e, Error::AdvanceTooLarge);
        }
        if advance_record(&e, &user).is_some() {
            panic_with_error!(&e, Error::AdvanceAlreadyOpen);
        }
        let outstanding = total_advanced(&e);
        if outstanding + amount > cfg.advance_cap {
            panic_with_error!(&e, Error::AdvanceCapExceeded);
        }

        if amount > liquid_assets(&e, &cfg) {
            panic_with_error!(&e, Error::InsufficientLiquidity);
        }

        // The user gets the full amount and repays it with the fee on top.
        // Only the principal is an asset; the fee is income the vault has not
        // earned until the money comes back.
        let fee = mul_div(&e, amount, cfg.advance_fee_bps as i128, BPS_DENOM);
        set_advance(&e, &user, Some(AdvanceRecord { principal: amount, owed: amount + fee }));
        set_total_advanced(&e, outstanding + amount);

        token::Client::new(&e, &cfg.usdc).transfer(&e.current_contract_address(), &user, &amount);

        events::advanced(&e, &user, amount, amount + fee, fee, outstanding + amount);
        amount
    }

    /// Repay an advance. Anyone may pay, which is the point: when the
    /// anchor's USDC lands in the user's wallet, the app hands it straight
    /// back without needing the relay again.
    pub fn repay_advance(e: Env, from: Address, user: Address, amount: i128) -> i128 {
        from.require_auth();
        let cfg = config(&e);
        if amount <= 0 {
            panic_with_error!(&e, Error::InvalidAmount);
        }
        let record = match advance_record(&e, &user) {
            Some(r) => r,
            None => panic_with_error!(&e, Error::NoAdvanceOpen),
        };
        // Never take more than is owed.
        let paying = if amount > record.owed { record.owed } else { amount };

        token::Client::new(&e, &cfg.usdc).transfer(&from, &e.current_contract_address(), &paying);

        // Principal is retired first; anything beyond it is the fee, and it
        // becomes yield the moment it lands.
        let principal_repaid = if paying > record.principal { record.principal } else { paying };
        let remaining = AdvanceRecord {
            principal: record.principal - principal_repaid,
            owed: record.owed - paying,
        };
        let outstanding = total_advanced(&e) - principal_repaid;
        set_advance(&e, &user, Some(remaining.clone()));
        set_total_advanced(&e, outstanding);

        events::repaid(&e, &user, paying, remaining.owed, outstanding);
        paying
    }

    /// Give up on an advance. The loss lands on the share price at once —
    /// there is nowhere else for it to go, and hiding it would be worse.
    pub fn write_off(e: Env, user: Address) -> i128 {
        let cfg = config(&e);
        cfg.admin.require_auth();
        let record = match advance_record(&e, &user) {
            Some(r) => r,
            None => panic_with_error!(&e, Error::NoAdvanceOpen),
        };
        set_advance(&e, &user, None);
        set_total_advanced(&e, total_advanced(&e) - record.principal);
        events::written_off(&e, &user, record.principal, total_assets(&e, &cfg));
        record.principal
    }

    // ---------------------------------------------------------------- views

    pub fn balance_of(e: Env, user: Address) -> i128 {
        shares_of(&e, &user)
    }

    pub fn total_shares(e: Env) -> i128 {
        total_shares(&e)
    }

    /// Everything the vault holds, including fees and yield.
    pub fn total_assets(e: Env) -> i128 {
        let cfg = config(&e);
        total_assets(&e, &cfg)
    }

    /// USDC per share, scaled by 1e7. Starts at 1.0 and only goes up.
    pub fn share_price(e: Env) -> i128 {
        let cfg = config(&e);
        let shares = total_shares(&e);
        if shares == 0 {
            return 1_0000000;
        }
        mul_div(&e, total_assets(&e, &cfg), 1_0000000, shares)
    }

    /// Shares this deposit would mint right now. Matches `deposit` exactly,
    /// including the sliver locked away on the very first one.
    pub fn preview_deposit(e: Env, assets: i128) -> i128 {
        let cfg = config(&e);
        let total_shares = total_shares(&e);
        if total_shares == 0 {
            if assets < MIN_INITIAL_DEPOSIT {
                return 0;
            }
            return assets - LOCKED_SHARES;
        }
        mul_div(&e, assets, total_shares, total_assets(&e, &cfg))
    }

    /// USDC this withdrawal would pay out right now, after the fee.
    pub fn preview_withdraw(e: Env, shares: i128) -> i128 {
        let cfg = config(&e);
        let total_shares = total_shares(&e);
        if total_shares == 0 || shares <= 0 {
            return 0;
        }
        let gross = mul_div(&e, shares, total_assets(&e, &cfg), total_shares);
        gross - mul_div(&e, gross, cfg.withdraw_fee_bps as i128, BPS_DENOM)
    }

    pub fn get_config(e: Env) -> Config {
        config(&e)
    }

    /// USDC in hand, which is the most a withdrawal can pay out right now.
    pub fn liquid_assets(e: Env) -> i128 {
        let cfg = config(&e);
        liquid_assets(&e, &cfg)
    }

    pub fn total_advanced(e: Env) -> i128 {
        total_advanced(&e)
    }

    /// What this user still has to repay, fee included.
    pub fn advance_of(e: Env, user: Address) -> i128 {
        advance_record(&e, &user).map(|r| r.owed).unwrap_or(0)
    }

    /// The part of that which is the vault's principal.
    pub fn advance_principal_of(e: Env, user: Address) -> i128 {
        advance_record(&e, &user).map(|r| r.principal).unwrap_or(0)
    }

    // ---------------------------------------------------------------- admin

    pub fn set_fee(e: Env, withdraw_fee_bps: u32) {
        let mut cfg = config(&e);
        cfg.admin.require_auth();
        if withdraw_fee_bps > MAX_FEE_BPS {
            panic_with_error!(&e, Error::InvalidFee);
        }
        cfg.withdraw_fee_bps = withdraw_fee_bps;
        save_config(&e, &cfg);
    }

    /// Pauses deposits only. Withdrawals stay open, always.
    pub fn set_paused(e: Env, paused: bool) {
        let mut cfg = config(&e);
        cfg.admin.require_auth();
        cfg.paused = paused;
        save_config(&e, &cfg);
    }

    pub fn set_deposit_cap(e: Env, deposit_cap: i128) {
        let mut cfg = config(&e);
        cfg.admin.require_auth();
        if deposit_cap < 0 {
            panic_with_error!(&e, Error::InvalidAmount);
        }
        cfg.deposit_cap = deposit_cap;
        save_config(&e, &cfg);
    }

    pub fn set_relay(e: Env, relay: Address) {
        let mut cfg = config(&e);
        cfg.admin.require_auth();
        cfg.relay = relay;
        save_config(&e, &cfg);
    }

    /// `max_advance = 0` switches advances off without touching open ones.
    pub fn set_advance_limits(e: Env, max_advance: i128, advance_cap: i128, advance_fee_bps: u32) {
        let mut cfg = config(&e);
        cfg.admin.require_auth();
        if max_advance < 0 || advance_cap < 0 {
            panic_with_error!(&e, Error::InvalidAmount);
        }
        if advance_fee_bps > MAX_FEE_BPS {
            panic_with_error!(&e, Error::InvalidFee);
        }
        cfg.max_advance = max_advance;
        cfg.advance_cap = advance_cap;
        cfg.advance_fee_bps = advance_fee_bps;
        save_config(&e, &cfg);
    }

    pub fn set_admin(e: Env, admin: Address) {
        let mut cfg = config(&e);
        cfg.admin.require_auth();
        cfg.admin = admin;
        save_config(&e, &cfg);
    }
}

/// The share token. Implementing SEP-41 is what makes a vault position
/// behave like an LP token anywhere else: transferable, delegable, and
/// readable by wallets without any special support for this contract.
#[contractimpl]
impl Vault {
    pub fn name(e: Env) -> String {
        token_impl::name(&e)
    }

    pub fn symbol(e: Env) -> String {
        token_impl::symbol(&e)
    }

    pub fn decimals(_e: Env) -> u32 {
        token_impl::DECIMALS
    }

    pub fn balance(e: Env, id: Address) -> i128 {
        token_impl::balance(&e, &id)
    }

    pub fn allowance(e: Env, from: Address, spender: Address) -> i128 {
        token_impl::allowance(&e, &from, &spender)
    }

    pub fn approve(e: Env, from: Address, spender: Address, amount: i128, expiration_ledger: u32) {
        from.require_auth();
        token_impl::set_allowance(&e, &from, &spender, amount, expiration_ledger);
    }

    pub fn transfer(e: Env, from: Address, to: Address, amount: i128) {
        from.require_auth();
        token_impl::transfer(&e, &from, &to, amount);
    }

    pub fn transfer_from(e: Env, spender: Address, from: Address, to: Address, amount: i128) {
        spender.require_auth();
        token_impl::transfer_from(&e, &spender, &from, &to, amount);
    }

    /// Destroy shares without taking the assets out. Everything behind them
    /// stays in the vault, so every remaining share gains.
    pub fn burn(e: Env, from: Address, amount: i128) {
        from.require_auth();
        token_impl::burn(&e, &from, amount);
    }

    pub fn burn_from(e: Env, spender: Address, from: Address, amount: i128) {
        spender.require_auth();
        token_impl::burn_from(&e, &spender, &from, amount);
    }
}

// -------------------------------------------------------------------- internals

fn config(e: &Env) -> Config {
    e.storage().instance().extend_ttl(TTL_THRESHOLD, TTL_BUMP);
    match e.storage().instance().get(&DataKey::Config) {
        Some(c) => c,
        None => panic_with_error!(e, Error::NotInitialized),
    }
}

fn save_config(e: &Env, cfg: &Config) {
    e.storage().instance().set(&DataKey::Config, cfg);
}

fn total_shares(e: &Env) -> i128 {
    token_impl::total_supply(e)
}

/// Everything the vault is worth: the USDC it holds plus the USDC it has
/// advanced and expects back.
///
/// Counting advances here is what keeps the share price steady while money
/// is out — fronting a deposit is a change of form, not a loss. A write-off
/// is the loss, and it shows up here immediately.
fn total_assets(e: &Env, cfg: &Config) -> i128 {
    liquid_assets(e, cfg) + total_advanced(e)
}

/// USDC actually in hand, which is all a withdrawal can be paid from.
fn liquid_assets(e: &Env, cfg: &Config) -> i128 {
    token::Client::new(e, &cfg.usdc).balance(&e.current_contract_address())
}

fn total_advanced(e: &Env) -> i128 {
    e.storage().instance().get(&DataKey::TotalAdvanced).unwrap_or(0)
}

fn set_total_advanced(e: &Env, value: i128) {
    e.storage().instance().set(&DataKey::TotalAdvanced, &value);
}

fn advance_record(e: &Env, user: &Address) -> Option<AdvanceRecord> {
    let key = DataKey::Advance(user.clone());
    let found = e.storage().persistent().get::<DataKey, AdvanceRecord>(&key);
    if found.is_some() {
        e.storage().persistent().extend_ttl(&key, TTL_THRESHOLD, TTL_BUMP);
    }
    found
}

fn set_advance(e: &Env, user: &Address, record: Option<AdvanceRecord>) {
    let key = DataKey::Advance(user.clone());
    match record {
        Some(r) if r.owed > 0 => {
            e.storage().persistent().set(&key, &r);
            e.storage().persistent().extend_ttl(&key, TTL_THRESHOLD, TTL_BUMP);
        }
        _ => e.storage().persistent().remove(&key),
    }
}

fn shares_of(e: &Env, user: &Address) -> i128 {
    token_impl::balance(e, user)
}

fn mul_div(e: &Env, a: i128, b: i128, d: i128) -> i128 {
    if d == 0 {
        panic_with_error!(e, Error::MathOverflow);
    }
    match a.checked_mul(b) {
        Some(v) => v / d,
        None => panic_with_error!(e, Error::MathOverflow),
    }
}
