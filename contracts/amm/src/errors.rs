use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    /// The pair must be two different tokens.
    IdenticalTokens = 3,
    InvalidFee = 4,

    InvalidAmount = 20,
    /// The first deposit is too small for the locked minimum to come out of it.
    InsufficientLiquidityMinted = 21,
    /// Burning this many LP tokens would return nothing.
    InsufficientLiquidityBurned = 22,
    InsufficientShares = 23,

    /// The swap would return less than the caller was willing to accept.
    InsufficientOutput = 30,
    /// `add_liquidity` could not honour the caller's minimum for token A.
    SlippageA = 31,
    /// ...or for token B.
    SlippageB = 32,
    /// The pool has nothing to trade against yet.
    InsufficientLiquidity = 33,
    /// `token_in` is neither side of this pair.
    UnknownToken = 34,

    // --- SEP-41 LP token ---
    InsufficientAllowance = 50,
    InvalidExpirationLedger = 51,
    InsufficientBalance = 52,

    MathOverflow = 40,
}
