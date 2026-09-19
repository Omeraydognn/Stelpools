//! Events.
//!
//! Vault events describe what happened to the pool; the token events are the
//! SEP-41 ones every wallet and indexer already understands.

use soroban_sdk::{contractevent, Address, Env};

// ------------------------------------------------------------------- vault

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Deposited {
    #[topic]
    pub user: Address,
    pub assets: i128,
    pub shares: i128,
    pub total_assets: i128,
    pub total_shares: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Withdrawn {
    #[topic]
    pub user: Address,
    pub assets: i128,
    pub shares: i128,
    pub fee: i128,
    pub total_assets: i128,
    pub total_shares: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Donated {
    #[topic]
    pub from: Address,
    pub assets: i128,
    pub total_assets: i128,
    pub total_shares: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Advanced {
    #[topic]
    pub user: Address,
    pub paid_out: i128,
    pub owed: i128,
    pub fee: i128,
    pub total_advanced: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Repaid {
    #[topic]
    pub user: Address,
    pub amount: i128,
    pub remaining: i128,
    pub total_advanced: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WrittenOff {
    #[topic]
    pub user: Address,
    pub amount: i128,
    pub total_assets: i128,
}

// ------------------------------------------------------------------- SEP-41

#[contractevent(topics = ["transfer"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Transfer {
    #[topic]
    pub from: Address,
    #[topic]
    pub to: Address,
    pub amount: i128,
}

#[contractevent(topics = ["approve"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Approve {
    #[topic]
    pub from: Address,
    #[topic]
    pub spender: Address,
    pub amount: i128,
    pub expiration_ledger: u32,
}

#[contractevent(topics = ["mint"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Mint {
    #[topic]
    pub to: Address,
    pub amount: i128,
}

#[contractevent(topics = ["burn"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Burn {
    #[topic]
    pub from: Address,
    pub amount: i128,
}

pub(crate) fn deposited(
    e: &Env,
    user: &Address,
    assets: i128,
    shares: i128,
    total_assets: i128,
    total_shares: i128,
) {
    Deposited { user: user.clone(), assets, shares, total_assets, total_shares }.publish(e);
}

pub(crate) fn withdrawn(
    e: &Env,
    user: &Address,
    assets: i128,
    shares: i128,
    fee: i128,
    total_assets: i128,
    total_shares: i128,
) {
    Withdrawn { user: user.clone(), assets, shares, fee, total_assets, total_shares }.publish(e);
}

pub(crate) fn donated(e: &Env, from: &Address, assets: i128, total_assets: i128, total_shares: i128) {
    Donated { from: from.clone(), assets, total_assets, total_shares }.publish(e);
}

pub(crate) fn advanced(
    e: &Env,
    user: &Address,
    paid_out: i128,
    owed: i128,
    fee: i128,
    total_advanced: i128,
) {
    Advanced { user: user.clone(), paid_out, owed, fee, total_advanced }.publish(e);
}

pub(crate) fn repaid(e: &Env, user: &Address, amount: i128, remaining: i128, total_advanced: i128) {
    Repaid { user: user.clone(), amount, remaining, total_advanced }.publish(e);
}

pub(crate) fn written_off(e: &Env, user: &Address, amount: i128, total_assets: i128) {
    WrittenOff { user: user.clone(), amount, total_assets }.publish(e);
}

pub(crate) fn transfer(e: &Env, from: &Address, to: &Address, amount: i128) {
    Transfer { from: from.clone(), to: to.clone(), amount }.publish(e);
}

pub(crate) fn approve(e: &Env, from: &Address, spender: &Address, amount: i128, expiration_ledger: u32) {
    Approve { from: from.clone(), spender: spender.clone(), amount, expiration_ledger }.publish(e);
}

pub(crate) fn mint(e: &Env, to: &Address, amount: i128) {
    Mint { to: to.clone(), amount }.publish(e);
}

pub(crate) fn burn(e: &Env, from: &Address, amount: i128) {
    Burn { from: from.clone(), amount }.publish(e);
}
