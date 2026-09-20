//! The LP position as a SEP-41 token.
//!
//! A pool position that cannot move is only half a position. Implementing the
//! standard token interface makes the LP token transferable, spendable
//! through an allowance, and legible to any wallet or protocol that already
//! speaks SEP-41 — the same thing an LP token does on other networks.

use soroban_sdk::{panic_with_error, Address, Env, String};

use crate::errors::Error;
use crate::events;
use crate::types::{AllowanceKey, AllowanceValue, DataKey};

const TTL_BUMP: u32 = 518_400;
const TTL_THRESHOLD: u32 = 120_960;

pub const DECIMALS: u32 = 7;

pub fn name(e: &Env) -> String {
    String::from_str(e, "Stelpools USDC/aTRY LP")
}

pub fn symbol(e: &Env) -> String {
    String::from_str(e, "spLP")
}

// ------------------------------------------------------------------ balances

pub fn balance(e: &Env, id: &Address) -> i128 {
    let key = DataKey::Balance(id.clone());
    match e.storage().persistent().get::<DataKey, i128>(&key) {
        Some(v) => {
            e.storage().persistent().extend_ttl(&key, TTL_THRESHOLD, TTL_BUMP);
            v
        }
        None => 0,
    }
}

fn set_balance(e: &Env, id: &Address, value: i128) {
    let key = DataKey::Balance(id.clone());
    if value == 0 {
        e.storage().persistent().remove(&key);
        return;
    }
    e.storage().persistent().set(&key, &value);
    e.storage().persistent().extend_ttl(&key, TTL_THRESHOLD, TTL_BUMP);
}

pub fn total_supply(e: &Env) -> i128 {
    e.storage().instance().get(&DataKey::TotalSupply).unwrap_or(0)
}

fn set_total_supply(e: &Env, value: i128) {
    e.storage().instance().set(&DataKey::TotalSupply, &value);
}

pub fn mint(e: &Env, to: &Address, amount: i128) {
    set_balance(e, to, balance(e, to) + amount);
    set_total_supply(e, total_supply(e) + amount);
    events::mint(e, to, amount);
}

/// Destroy LP tokens. The caller must already have checked authorisation.
pub fn burn_shares(e: &Env, from: &Address, amount: i128) {
    let held = balance(e, from);
    if held < amount {
        panic_with_error!(e, Error::InsufficientBalance);
    }
    set_balance(e, from, held - amount);
    set_total_supply(e, total_supply(e) - amount);
}

// ---------------------------------------------------------------- allowances

pub fn allowance(e: &Env, from: &Address, spender: &Address) -> i128 {
    let key = DataKey::Allowance(AllowanceKey { from: from.clone(), spender: spender.clone() });
    match e.storage().temporary().get::<DataKey, AllowanceValue>(&key) {
        // An expired allowance reads as zero rather than lingering.
        Some(v) if v.expiration_ledger >= e.ledger().sequence() => v.amount,
        _ => 0,
    }
}

pub fn set_allowance(e: &Env, from: &Address, spender: &Address, amount: i128, expiration_ledger: u32) {
    if amount < 0 {
        panic_with_error!(e, Error::InvalidAmount);
    }
    // SEP-41: a non-zero allowance must not already be expired.
    if amount > 0 && expiration_ledger < e.ledger().sequence() {
        panic_with_error!(e, Error::InvalidExpirationLedger);
    }

    let key = DataKey::Allowance(AllowanceKey { from: from.clone(), spender: spender.clone() });
    e.storage()
        .temporary()
        .set(&key, &AllowanceValue { amount, expiration_ledger });

    if amount > 0 {
        let live_for = expiration_ledger.saturating_sub(e.ledger().sequence());
        e.storage().temporary().extend_ttl(&key, live_for, live_for);
    }
    events::approve(e, from, spender, amount, expiration_ledger);
}

fn spend_allowance(e: &Env, from: &Address, spender: &Address, amount: i128) {
    let current = allowance(e, from, spender);
    if current < amount {
        panic_with_error!(e, Error::InsufficientAllowance);
    }
    let key = DataKey::Allowance(AllowanceKey { from: from.clone(), spender: spender.clone() });
    let expiration_ledger = e
        .storage()
        .temporary()
        .get::<DataKey, AllowanceValue>(&key)
        .map(|v| v.expiration_ledger)
        .unwrap_or(0);
    e.storage()
        .temporary()
        .set(&key, &AllowanceValue { amount: current - amount, expiration_ledger });
}

// ----------------------------------------------------------------- transfers

pub fn transfer(e: &Env, from: &Address, to: &Address, amount: i128) {
    if amount <= 0 {
        panic_with_error!(e, Error::InvalidAmount);
    }
    let held = balance(e, from);
    if held < amount {
        panic_with_error!(e, Error::InsufficientBalance);
    }
    set_balance(e, from, held - amount);
    set_balance(e, to, balance(e, to) + amount);
    events::transfer(e, from, to, amount);
}

pub fn transfer_from(e: &Env, spender: &Address, from: &Address, to: &Address, amount: i128) {
    spend_allowance(e, from, spender, amount);
    transfer(e, from, to, amount);
}

/// Burn without withdrawing: the reserves behind these LP tokens stay in the
/// pool, so every remaining LP token becomes worth more.
pub fn burn(e: &Env, from: &Address, amount: i128) {
    if amount <= 0 {
        panic_with_error!(e, Error::InvalidAmount);
    }
    burn_shares(e, from, amount);
    events::burn(e, from, amount);
}

pub fn burn_from(e: &Env, spender: &Address, from: &Address, amount: i128) {
    spend_allowance(e, from, spender, amount);
    burn(e, from, amount);
}
