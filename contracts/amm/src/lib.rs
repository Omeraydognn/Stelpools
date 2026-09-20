#![no_std]
//! A constant-product AMM for USDC ⇄ aTRY.
//!
//! `x * y = k`, in the shape Uniswap v2 settled on. The price is not quoted
//! by anyone: it is whatever the ratio of the two reserves says it is, and
//! it moves only because someone traded. There is no admin, no oracle, no
//! webhook and no allowlist — after the constructor runs, the only things
//! that can change this pool's state are `add_liquidity`, `remove_liquidity`,
//! `swap` and `sync`, and every one of them is open to anybody.
//!
//! Fiat never touches this contract. Lira enters and leaves through the
//! anchor, which issues aTRY; by the time a user reaches the pool they hold
//! a token like any other.

mod errors;
mod events;
mod math;
mod token_impl;
mod types;

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, panic_with_error, token, Address, Env, String};

pub use errors::Error;
pub use types::{Config, DataKey, Reserves};

use math::{add, amount_in, amount_out, div, min, mul, quote, sqrt, sub};

const TTL_BUMP: u32 = 518_400; // ~30 days of ledgers
const TTL_THRESHOLD: u32 = 120_960; // re-bump under ~7 days

/// Uniswap's MINIMUM_LIQUIDITY. The first deposit gives up this many LP
/// tokens to the contract itself, permanently. Without it the pool could be
/// emptied to one unit and its share price inflated by donation.
const LOCKED_SHARES: i128 = 1_000;

/// The largest fee the pair can be created with. Not an admin control —
/// nothing can change the fee after deployment; this only bounds what the
/// deployer may write into the constructor.
const MAX_FEE_BPS: u32 = 100; // 1%

#[contract]
pub struct Amm;

#[contractimpl]
impl Amm {
    /// Fix the pair and the fee. Runs once, at deployment.
    pub fn __constructor(e: Env, token_a: Address, token_b: Address, fee_bps: u32) {
        if e.storage().instance().has(&DataKey::Config) {
            panic_with_error!(&e, Error::AlreadyInitialized);
        }
        if token_a == token_b {
            panic_with_error!(&e, Error::IdenticalTokens);
        }
        if fee_bps > MAX_FEE_BPS {
            panic_with_error!(&e, Error::InvalidFee);
        }
        e.storage()
            .instance()
            .set(&DataKey::Config, &Config { token_a, token_b, fee_bps });
        e.storage().instance().set(&DataKey::Reserves, &Reserves { a: 0, b: 0 });
        e.storage().instance().extend_ttl(TTL_THRESHOLD, TTL_BUMP);
    }

    // ------------------------------------------------------------ liquidity

    /// Put both sides in and receive LP tokens.
    ///
    /// The first provider sets the price, because nothing else can: whatever
    /// ratio they deposit is the ratio the pool starts at. Everyone after
    /// them deposits at the ratio already there — one desired amount decides
    /// the other, and the unused remainder is simply not taken.
    ///
    /// `min_a` and `min_b` are the caller's protection: between building the
    /// transaction and it landing, somebody else's swap can move the ratio.
    pub fn add_liquidity(
        e: Env,
        provider: Address,
        amount_a_desired: i128,
        amount_b_desired: i128,
        min_a: i128,
        min_b: i128,
    ) -> (i128, i128, i128) {
        provider.require_auth();
        let cfg = config(&e);
        if amount_a_desired <= 0 || amount_b_desired <= 0 {
            panic_with_error!(&e, Error::InvalidAmount);
        }

        let reserves = reserves(&e);
        let supply = token_impl::total_supply(&e);

        let (amount_a, amount_b) = if supply == 0 {
            (amount_a_desired, amount_b_desired)
        } else {
            let b_optimal = quote(&e, amount_a_desired, reserves.a, reserves.b);
            if b_optimal <= amount_b_desired {
                (amount_a_desired, b_optimal)
            } else {
                let a_optimal = quote(&e, amount_b_desired, reserves.b, reserves.a);
                (a_optimal, amount_b_desired)
            }
        };
        if amount_a < min_a {
            panic_with_error!(&e, Error::SlippageA);
        }
        if amount_b < min_b {
            panic_with_error!(&e, Error::SlippageB);
        }

        let shares = if supply == 0 {
            // Geometric mean, less the sliver that is locked away forever.
            let minted = sub(&e, sqrt(mul(&e, amount_a, amount_b)), LOCKED_SHARES);
            if minted <= 0 {
                panic_with_error!(&e, Error::InsufficientLiquidityMinted);
            }
            token_impl::mint(&e, &e.current_contract_address(), LOCKED_SHARES);
            minted
        } else {
            // The smaller of the two claims, so a lopsided deposit cannot
            // mint more than the side it actually matched.
            min(
                div(&e, mul(&e, amount_a, supply), reserves.a),
                div(&e, mul(&e, amount_b, supply), reserves.b),
            )
        };
        if shares <= 0 {
            panic_with_error!(&e, Error::InsufficientLiquidityMinted);
        }

        let here = e.current_contract_address();
        token::Client::new(&e, &cfg.token_a).transfer(&provider, &here, &amount_a);
        token::Client::new(&e, &cfg.token_b).transfer(&provider, &here, &amount_b);
        token_impl::mint(&e, &provider, shares);

        let next = Reserves { a: add(&e, reserves.a, amount_a), b: add(&e, reserves.b, amount_b) };
        set_reserves(&e, &next);

        events::LiquidityAdded {
            provider,
            amount_a,
            amount_b,
            shares,
            reserve_a: next.a,
            reserve_b: next.b,
            total_shares: token_impl::total_supply(&e),
        }
        .publish(&e);

        (amount_a, amount_b, shares)
    }

    /// Burn LP tokens and take back a proportional slice of both reserves.
    ///
    /// The slice is always in the pool's current ratio, so a provider who
    /// arrives when the price has moved gets back a different mix than they
    /// put in. That difference is impermanent loss, and it is inherent to
    /// the model rather than something this contract can soften.
    pub fn remove_liquidity(
        e: Env,
        provider: Address,
        shares: i128,
        min_a: i128,
        min_b: i128,
    ) -> (i128, i128) {
        provider.require_auth();
        let cfg = config(&e);
        if shares <= 0 {
            panic_with_error!(&e, Error::InvalidAmount);
        }
        if token_impl::balance(&e, &provider) < shares {
            panic_with_error!(&e, Error::InsufficientShares);
        }

        let reserves = reserves(&e);
        let supply = token_impl::total_supply(&e);
        let amount_a = div(&e, mul(&e, shares, reserves.a), supply);
        let amount_b = div(&e, mul(&e, shares, reserves.b), supply);
        if amount_a <= 0 || amount_b <= 0 {
            panic_with_error!(&e, Error::InsufficientLiquidityBurned);
        }
        if amount_a < min_a {
            panic_with_error!(&e, Error::SlippageA);
        }
        if amount_b < min_b {
            panic_with_error!(&e, Error::SlippageB);
        }

        token_impl::burn_shares(&e, &provider, shares);

        let here = e.current_contract_address();
        token::Client::new(&e, &cfg.token_a).transfer(&here, &provider, &amount_a);
        token::Client::new(&e, &cfg.token_b).transfer(&here, &provider, &amount_b);

        let next = Reserves { a: sub(&e, reserves.a, amount_a), b: sub(&e, reserves.b, amount_b) };
        set_reserves(&e, &next);

        events::LiquidityRemoved {
            provider,
            amount_a,
            amount_b,
            shares,
            reserve_a: next.a,
            reserve_b: next.b,
            total_shares: token_impl::total_supply(&e),
        }
        .publish(&e);

        (amount_a, amount_b)
    }

    // ----------------------------------------------------------------- swap

    /// Trade one side of the pair for the other.
    ///
    /// `min_out` is not optional in spirit: the price this returns depends on
    /// the reserves at the moment it executes, and anyone can trade ahead of
    /// you in the same ledger. Passing 0 means accepting any price at all.
    pub fn swap(
        e: Env,
        trader: Address,
        token_in: Address,
        amount_in_: i128,
        min_out: i128,
    ) -> i128 {
        trader.require_auth();
        let cfg = config(&e);
        if amount_in_ <= 0 {
            panic_with_error!(&e, Error::InvalidAmount);
        }

        let reserves = reserves(&e);
        let a_in = if token_in == cfg.token_a {
            true
        } else if token_in == cfg.token_b {
            false
        } else {
            panic_with_error!(&e, Error::UnknownToken)
        };

        let (reserve_in, reserve_out) =
            if a_in { (reserves.a, reserves.b) } else { (reserves.b, reserves.a) };
        let out = amount_out(&e, amount_in_, reserve_in, reserve_out, cfg.fee_bps);
        if out <= 0 {
            panic_with_error!(&e, Error::InsufficientOutput);
        }
        if out < min_out {
            panic_with_error!(&e, Error::InsufficientOutput);
        }
        if out >= reserve_out {
            // The curve makes this unreachable, but the pool must never be
            // able to promise more than it holds.
            panic_with_error!(&e, Error::InsufficientLiquidity);
        }

        let token_out = if a_in { cfg.token_b.clone() } else { cfg.token_a.clone() };
        let here = e.current_contract_address();
        token::Client::new(&e, &token_in).transfer(&trader, &here, &amount_in_);
        token::Client::new(&e, &token_out).transfer(&here, &trader, &out);

        let next = if a_in {
            Reserves { a: add(&e, reserves.a, amount_in_), b: sub(&e, reserves.b, out) }
        } else {
            Reserves { a: sub(&e, reserves.a, out), b: add(&e, reserves.b, amount_in_) }
        };
        set_reserves(&e, &next);

        // The fee never leaves: it stays in the reserves, which is how the
        // LP tokens gain value.
        let fee = div(&e, mul(&e, amount_in_, cfg.fee_bps as i128), 10_000);
        events::Swapped {
            trader,
            token_in,
            amount_in: amount_in_,
            amount_out: out,
            fee,
            reserve_a: next.a,
            reserve_b: next.b,
        }
        .publish(&e);

        out
    }

    /// Fold any tokens that arrived outside a deposit into the reserves.
    ///
    /// Anyone may call it; it can only ever raise the reserves, which lifts
    /// every LP token equally. This is also the escape hatch that keeps a
    /// donation from sitting unusable forever.
    pub fn sync(e: Env) -> Reserves {
        let cfg = config(&e);
        let here = e.current_contract_address();
        let next = Reserves {
            a: token::Client::new(&e, &cfg.token_a).balance(&here),
            b: token::Client::new(&e, &cfg.token_b).balance(&here),
        };
        set_reserves(&e, &next);
        events::Synced { reserve_a: next.a, reserve_b: next.b }.publish(&e);
        next
    }

    // ---------------------------------------------------------------- views

    pub fn get_config(e: Env) -> Config {
        config(&e)
    }

    pub fn get_reserves(e: Env) -> Reserves {
        reserves(&e)
    }

    /// What `swap` would return right now, fee included.
    pub fn get_amount_out(e: Env, token_in: Address, amount_in_: i128) -> i128 {
        let cfg = config(&e);
        let r = reserves(&e);
        let (reserve_in, reserve_out) = if token_in == cfg.token_a {
            (r.a, r.b)
        } else if token_in == cfg.token_b {
            (r.b, r.a)
        } else {
            panic_with_error!(&e, Error::UnknownToken)
        };
        amount_out(&e, amount_in_, reserve_in, reserve_out, cfg.fee_bps)
    }

    /// What you would have to put in to get exactly `amount_out_` out.
    pub fn get_amount_in(e: Env, token_in: Address, amount_out_: i128) -> i128 {
        let cfg = config(&e);
        let r = reserves(&e);
        let (reserve_in, reserve_out) = if token_in == cfg.token_a {
            (r.a, r.b)
        } else if token_in == cfg.token_b {
            (r.b, r.a)
        } else {
            panic_with_error!(&e, Error::UnknownToken)
        };
        amount_in(&e, amount_out_, reserve_in, reserve_out, cfg.fee_bps)
    }

    /// The other side of a deposit at the current ratio, so the interface can
    /// fill the second field as the user types the first.
    pub fn quote_liquidity(e: Env, token_in: Address, amount_in_: i128) -> i128 {
        let cfg = config(&e);
        let r = reserves(&e);
        if r.a == 0 || r.b == 0 {
            // An empty pool has no ratio yet — the first provider chooses it.
            return 0;
        }
        if token_in == cfg.token_a {
            quote(&e, amount_in_, r.a, r.b)
        } else if token_in == cfg.token_b {
            quote(&e, amount_in_, r.b, r.a)
        } else {
            panic_with_error!(&e, Error::UnknownToken)
        }
    }

    /// What burning `shares` would return right now.
    pub fn preview_remove(e: Env, shares: i128) -> (i128, i128) {
        let r = reserves(&e);
        let supply = token_impl::total_supply(&e);
        if supply <= 0 || shares <= 0 {
            return (0, 0);
        }
        (
            div(&e, mul(&e, shares, r.a), supply),
            div(&e, mul(&e, shares, r.b), supply),
        )
    }

    /// Token B per token A, scaled by 1e7. Purely a reading of the reserves.
    pub fn spot_price(e: Env) -> i128 {
        let r = reserves(&e);
        if r.a <= 0 {
            return 0;
        }
        div(&e, mul(&e, r.b, 10_000_000), r.a)
    }

    // --------------------------------------------------- SEP-41 LP token

    pub fn name(e: Env) -> String {
        token_impl::name(&e)
    }

    pub fn symbol(e: Env) -> String {
        token_impl::symbol(&e)
    }

    pub fn decimals(_e: Env) -> u32 {
        token_impl::DECIMALS
    }

    pub fn total_shares(e: Env) -> i128 {
        token_impl::total_supply(&e)
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

    pub fn burn(e: Env, from: Address, amount: i128) {
        from.require_auth();
        token_impl::burn(&e, &from, amount);
    }

    pub fn burn_from(e: Env, spender: Address, from: Address, amount: i128) {
        spender.require_auth();
        token_impl::burn_from(&e, &spender, &from, amount);
    }
}

// ------------------------------------------------------------------ storage

fn config(e: &Env) -> Config {
    match e.storage().instance().get::<DataKey, Config>(&DataKey::Config) {
        Some(cfg) => {
            e.storage().instance().extend_ttl(TTL_THRESHOLD, TTL_BUMP);
            cfg
        }
        None => panic_with_error!(e, Error::NotInitialized),
    }
}

fn reserves(e: &Env) -> Reserves {
    e.storage()
        .instance()
        .get::<DataKey, Reserves>(&DataKey::Reserves)
        .unwrap_or(Reserves { a: 0, b: 0 })
}

fn set_reserves(e: &Env, r: &Reserves) {
    e.storage().instance().set(&DataKey::Reserves, r);
    e.storage().instance().extend_ttl(TTL_THRESHOLD, TTL_BUMP);
}
