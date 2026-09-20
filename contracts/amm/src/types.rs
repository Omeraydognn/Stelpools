use soroban_sdk::{contracttype, Address};

/// Everything the pool knows about itself.
///
/// There is no admin, no oracle, no pause switch and no allowlist. The pair
/// is fixed at deployment and the fee is a constant, so after the
/// constructor runs nobody — including whoever deployed it — can change how
/// this contract behaves.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Config {
    /// Stellar Asset Contract of the first token in the pair (USDC).
    pub token_a: Address,
    /// Stellar Asset Contract of the second token (aTRY).
    pub token_b: Address,
    /// Swap fee in basis points, fixed at deployment.
    pub fee_bps: u32,
}

/// What the pool believes it holds.
///
/// Tracked rather than read from the token balances: a price that follows
/// the raw balance can be pushed around by sending tokens straight to the
/// contract. Anything that does arrive that way is only counted when
/// `sync` folds it in, where it lifts every LP equally.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Reserves {
    pub a: i128,
    pub b: i128,
}

/// SEP-41 allowance: an amount that expires at a ledger.
#[contracttype]
#[derive(Clone)]
pub struct AllowanceKey {
    pub from: Address,
    pub spender: Address,
}

#[contracttype]
#[derive(Clone)]
pub struct AllowanceValue {
    pub amount: i128,
    pub expiration_ledger: u32,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Config,
    Reserves,
    /// LP tokens in circulation.
    TotalSupply,
    /// LP balance of one holder.
    Balance(Address),
    Allowance(AllowanceKey),
}
