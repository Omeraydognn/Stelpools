//! The constant-product maths, kept apart from storage so it can be read
//! and tested as plain arithmetic.

use soroban_sdk::{panic_with_error, Env};

use crate::errors::Error;

const BPS_DENOM: i128 = 10_000;

fn overflow(e: &Env) -> ! {
    panic_with_error!(e, Error::MathOverflow)
}

pub fn mul(e: &Env, a: i128, b: i128) -> i128 {
    a.checked_mul(b).unwrap_or_else(|| overflow(e))
}

pub fn add(e: &Env, a: i128, b: i128) -> i128 {
    a.checked_add(b).unwrap_or_else(|| overflow(e))
}

pub fn sub(e: &Env, a: i128, b: i128) -> i128 {
    a.checked_sub(b).unwrap_or_else(|| overflow(e))
}

pub fn div(e: &Env, a: i128, b: i128) -> i128 {
    if b == 0 {
        overflow(e)
    }
    a / b
}

/// Integer square root, Newton's method. Used once, for the first deposit.
pub fn sqrt(y: i128) -> i128 {
    if y <= 0 {
        return 0;
    }
    if y < 4 {
        return 1;
    }
    let mut z = y;
    let mut x = y / 2 + 1;
    while x < z {
        z = x;
        x = (y / x + x) / 2;
    }
    z
}

/// The other side of a deposit at the pool's current ratio.
///
/// Adding liquidity must not move the price, so one amount decides the
/// other: `b = a × reserve_b / reserve_a`.
pub fn quote(e: &Env, amount_a: i128, reserve_a: i128, reserve_b: i128) -> i128 {
    if amount_a <= 0 {
        panic_with_error!(e, Error::InvalidAmount);
    }
    if reserve_a <= 0 || reserve_b <= 0 {
        panic_with_error!(e, Error::InsufficientLiquidity);
    }
    div(e, mul(e, amount_a, reserve_b), reserve_a)
}

/// What a swap of `amount_in` returns, after the fee.
///
/// Constant product with the fee taken off the input, exactly as Uniswap v2
/// does it: `out = (in' × reserve_out) / (reserve_in + in')` where `in'` is
/// the input less the fee. The product of the reserves therefore grows by
/// the fee on every trade, and that growth is what LPs earn.
pub fn amount_out(
    e: &Env,
    amount_in: i128,
    reserve_in: i128,
    reserve_out: i128,
    fee_bps: u32,
) -> i128 {
    if amount_in <= 0 {
        panic_with_error!(e, Error::InvalidAmount);
    }
    if reserve_in <= 0 || reserve_out <= 0 {
        panic_with_error!(e, Error::InsufficientLiquidity);
    }
    let after_fee = mul(e, amount_in, BPS_DENOM - fee_bps as i128);
    let numerator = mul(e, after_fee, reserve_out);
    let denominator = add(e, mul(e, reserve_in, BPS_DENOM), after_fee);
    div(e, numerator, denominator)
}

/// The input needed to receive exactly `amount_out`. Rounds up, so the pool
/// is never the one that loses the remainder.
pub fn amount_in(
    e: &Env,
    amount_out: i128,
    reserve_in: i128,
    reserve_out: i128,
    fee_bps: u32,
) -> i128 {
    if amount_out <= 0 {
        panic_with_error!(e, Error::InvalidAmount);
    }
    if reserve_in <= 0 || reserve_out <= amount_out {
        panic_with_error!(e, Error::InsufficientLiquidity);
    }
    let numerator = mul(e, mul(e, reserve_in, amount_out), BPS_DENOM);
    let denominator = mul(e, sub(e, reserve_out, amount_out), BPS_DENOM - fee_bps as i128);
    add(e, div(e, numerator, denominator), 1)
}

pub fn min(a: i128, b: i128) -> i128 {
    if a < b {
        a
    } else {
        b
    }
}
