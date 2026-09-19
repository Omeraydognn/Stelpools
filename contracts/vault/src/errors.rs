use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Paused = 3,
    NotAdmin = 10,

    InvalidAmount = 20,
    /// The first deposit must be large enough that share pricing is stable.
    BelowMinimumDeposit = 21,
    /// The deposit is so small it would round down to zero shares.
    DepositTooSmall = 22,
    InsufficientShares = 23,
    /// Withdrawing this many shares would pay out nothing.
    WithdrawTooSmall = 24,

    InvalidFee = 30,
    /// The deposit would push the vault past its cap.
    CapExceeded = 31,

    // --- SEP-41 share token ---
    InsufficientAllowance = 50,
    InvalidExpirationLedger = 51,
    InsufficientBalance = 52,

    // --- advances ---
    /// Advances are switched off, or this one is over the limit.
    AdvancesDisabled = 60,
    AdvanceTooLarge = 61,
    AdvanceCapExceeded = 62,
    /// This user already owes the vault for an advance.
    AdvanceAlreadyOpen = 63,
    NoAdvanceOpen = 64,
    /// The vault does not hold enough spendable USDC right now.
    InsufficientLiquidity = 65,

    MathOverflow = 40,
}
