//! Events.
//!
//! Pool events describe what happened to the reserves; the token events are
//! the SEP-41 ones every wallet and indexer already understands.

use soroban_sdk::{contractevent, Address, Env};

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LiquidityAdded {
    #[topic]
    pub provider: Address,
    pub amount_a: i128,
    pub amount_b: i128,
    pub shares: i128,
    pub reserve_a: i128,
    pub reserve_b: i128,
    pub total_shares: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LiquidityRemoved {
    #[topic]
    pub provider: Address,
    pub amount_a: i128,
    pub amount_b: i128,
    pub shares: i128,
    pub reserve_a: i128,
    pub reserve_b: i128,
    pub total_shares: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Swapped {
    #[topic]
    pub trader: Address,
    #[topic]
    pub token_in: Address,
    pub amount_in: i128,
    pub amount_out: i128,
    pub fee: i128,
    pub reserve_a: i128,
    pub reserve_b: i128,
}

/// Tokens that arrived outside a deposit, folded into the reserves. They
/// belong to every LP in proportion, exactly like a swap fee.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Synced {
    pub reserve_a: i128,
    pub reserve_b: i128,
}

// ------------------------------------------------------------ SEP-41 token

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Transfer {
    #[topic]
    pub from: Address,
    #[topic]
    pub to: Address,
    pub amount: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Approve {
    #[topic]
    pub from: Address,
    #[topic]
    pub spender: Address,
    pub amount: i128,
    pub expiration_ledger: u32,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Mint {
    #[topic]
    pub to: Address,
    pub amount: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Burn {
    #[topic]
    pub from: Address,
    pub amount: i128,
}

pub fn transfer(e: &Env, from: &Address, to: &Address, amount: i128) {
    Transfer { from: from.clone(), to: to.clone(), amount }.publish(e);
}

pub fn approve(e: &Env, from: &Address, spender: &Address, amount: i128, expiration_ledger: u32) {
    Approve { from: from.clone(), spender: spender.clone(), amount, expiration_ledger }.publish(e);
}

pub fn mint(e: &Env, to: &Address, amount: i128) {
    Mint { to: to.clone(), amount }.publish(e);
}

pub fn burn(e: &Env, from: &Address, amount: i128) {
    Burn { from: from.clone(), amount }.publish(e);
}
