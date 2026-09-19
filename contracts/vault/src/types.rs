use soroban_sdk::{contracttype, Address};

#[contracttype]
#[derive(Clone, Debug)]
pub struct Config {
    /// Can change fees and caps, and pause deposits.
    pub admin: Address,
    /// Stellar Asset Contract id of the pooled asset (USDC).
    pub usdc: Address,
    /// Taken on withdrawal and left in the vault, so it accrues to everyone
    /// who stayed. This is what makes an LP's yield real rather than notional.
    pub withdraw_fee_bps: u32,
    /// Refuses deposits that would push total assets past this. 0 = no cap.
    pub deposit_cap: i128,
    /// Allowed to open advances. This is the settlement watcher: it has seen
    /// the anchor accept a deposit and vouches that the USDC is coming.
    pub relay: Address,
    /// Largest single advance. 0 disables advances entirely.
    pub max_advance: i128,
    /// Ceiling on everything outstanding at once.
    pub advance_cap: i128,
    /// Charged on an advance and kept by the vault when it is repaid.
    pub advance_fee_bps: u32,
    /// Blocks new deposits. Withdrawals are never blocked.
    pub paused: bool,
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

/// One user's open advance.
///
/// `principal` is the USDC that actually left the vault and is the only part
/// counted as an asset. `owed` is principal plus the fee; the difference is
/// income the vault has not earned until it is repaid.
#[contracttype]
#[derive(Clone, Debug)]
pub struct AdvanceRecord {
    pub principal: i128,
    pub owed: i128,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Config,
    /// Shares in circulation.
    TotalSupply,
    /// Share balance of one holder.
    Balance(Address),
    Allowance(AllowanceKey),
    /// USDC a user owes the vault for an advance they have already received.
    Advance(Address),
    /// Principal out on advance across all users.
    TotalAdvanced,
}
