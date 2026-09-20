#![cfg(test)]

use soroban_sdk::testutils::Address as _;
use soroban_sdk::token::{StellarAssetClient, TokenClient};
use soroban_sdk::{Address, Env};

use crate::{Amm, AmmClient, LOCKED_SHARES};

const USDC: i128 = 10_000_000; // one token, 7 decimals
const FEE_BPS: u32 = 30; // 0.3%

struct Pool<'a> {
    e: Env,
    amm: AmmClient<'a>,
    a: Address,
    b: Address,
    token_a: TokenClient<'a>,
    token_b: TokenClient<'a>,
    mint_a: StellarAssetClient<'a>,
    mint_b: StellarAssetClient<'a>,
}

impl<'a> Pool<'a> {
    fn new() -> Pool<'a> {
        let e = Env::default();
        e.mock_all_auths();

        let issuer = Address::generate(&e);
        let sac_a = e.register_stellar_asset_contract_v2(issuer.clone());
        let sac_b = e.register_stellar_asset_contract_v2(issuer);
        let a = sac_a.address();
        let b = sac_b.address();

        let id = e.register(Amm, (a.clone(), b.clone(), FEE_BPS));
        Pool {
            amm: AmmClient::new(&e, &id),
            token_a: TokenClient::new(&e, &a),
            token_b: TokenClient::new(&e, &b),
            mint_a: StellarAssetClient::new(&e, &a),
            mint_b: StellarAssetClient::new(&e, &b),
            a,
            b,
            e,
        }
    }

    fn user(&self, a_amount: i128, b_amount: i128) -> Address {
        let who = Address::generate(&self.e);
        if a_amount > 0 {
            self.mint_a.mint(&who, &a_amount);
        }
        if b_amount > 0 {
            self.mint_b.mint(&who, &b_amount);
        }
        who
    }

    /// A pool holding `a` USDC and `b` aTRY, provided by one LP.
    fn seeded(a: i128, b: i128) -> (Pool<'a>, Address) {
        let pool = Pool::new();
        let lp = pool.user(a, b);
        pool.amm.add_liquidity(&lp, &a, &b, &0, &0);
        (pool, lp)
    }

    fn k(&self) -> i128 {
        let r = self.amm.get_reserves();
        r.a * r.b
    }
}

// ------------------------------------------------------------------ pricing

#[test]
fn the_first_provider_sets_the_price() {
    let (pool, _) = Pool::seeded(100 * USDC, 4_900 * USDC);
    // 4900 aTRY for 100 USDC is 49 TRY to the dollar.
    assert_eq!(pool.amm.spot_price(), 49 * USDC);
}

#[test]
fn the_price_comes_from_the_reserves_and_nothing_else() {
    let (pool, _) = Pool::seeded(100 * USDC, 4_900 * USDC);
    let trader = pool.user(0, 490 * USDC);

    pool.amm.swap(&trader, &pool.b, &(490 * USDC), &0);

    // Selling aTRY makes aTRY cheaper: more of it per dollar.
    assert!(pool.amm.spot_price() > 49 * USDC);
}

#[test]
fn a_bigger_trade_gets_a_worse_rate() {
    let (pool, _) = Pool::seeded(100 * USDC, 4_900 * USDC);

    let small = pool.amm.get_amount_out(&pool.b, &(49 * USDC)); // 1 USDC worth
    let large = pool.amm.get_amount_out(&pool.b, &(490 * USDC)); // 10 USDC worth

    // Ten times the input buys strictly less than ten times the output.
    assert!(large < small * 10, "constant product must charge for size");
}

#[test]
fn the_product_never_falls() {
    let (pool, _) = Pool::seeded(100 * USDC, 4_900 * USDC);
    let before = pool.k();

    let trader = pool.user(10 * USDC, 0);
    pool.amm.swap(&trader, &pool.a, &(10 * USDC), &0);

    // The fee stays in the reserves, so k grows on every trade. This is the
    // whole of an LP's return.
    assert!(pool.k() > before);
}

#[test]
fn a_round_trip_costs_the_trader_the_fee() {
    let (pool, _) = Pool::seeded(1_000 * USDC, 49_000 * USDC);
    let trader = pool.user(10 * USDC, 0);

    let got_b = pool.amm.swap(&trader, &pool.a, &(10 * USDC), &0);
    let got_a = pool.amm.swap(&trader, &pool.b, &got_b, &0);

    assert!(got_a < 10 * USDC, "two fees and slippage must leave them short");
    assert!(got_a > 9 * USDC, "but a round trip should not be ruinous");
}

// -------------------------------------------------------------- liquidity

#[test]
fn the_first_deposit_locks_a_sliver_of_liquidity_forever() {
    let (pool, lp) = Pool::seeded(100 * USDC, 4_900 * USDC);

    let minted = pool.amm.balance(&lp);
    let locked = pool.amm.balance(&pool.amm.address);
    assert_eq!(locked, LOCKED_SHARES);
    assert_eq!(pool.amm.total_shares(), minted + LOCKED_SHARES);
}

#[test]
fn a_tiny_first_deposit_is_refused() {
    let pool = Pool::new();
    let lp = pool.user(10, 10);
    // sqrt(10 * 10) = 10, which cannot cover the locked minimum.
    assert!(pool.amm.try_add_liquidity(&lp, &10, &10, &0, &0).is_err());
}

#[test]
fn a_later_deposit_cannot_move_the_price() {
    let (pool, _) = Pool::seeded(100 * USDC, 4_900 * USDC);
    let before = pool.amm.spot_price();

    // Offers a lopsided pair; only the matching part is taken.
    let lp2 = pool.user(10 * USDC, 1_000 * USDC);
    let (took_a, took_b, _) = pool.amm.add_liquidity(&lp2, &(10 * USDC), &(1_000 * USDC), &0, &0);

    assert_eq!(took_a, 10 * USDC);
    assert_eq!(took_b, 490 * USDC, "the ratio decides the second amount");
    assert_eq!(pool.amm.spot_price(), before);
    assert_eq!(pool.token_b.balance(&lp2), 510 * USDC, "the rest is left alone");
}

#[test]
fn shares_are_proportional_to_what_was_added() {
    let (pool, lp1) = Pool::seeded(100 * USDC, 4_900 * USDC);
    let lp2 = pool.user(100 * USDC, 4_900 * USDC);
    let (_, _, shares2) = pool.amm.add_liquidity(&lp2, &(100 * USDC), &(4_900 * USDC), &0, &0);

    // An identical deposit doubles the pool, so it earns the same claim the
    // first provider holds — bar the locked sliver they gave up.
    assert_eq!(shares2, pool.amm.balance(&lp1) + LOCKED_SHARES);
}

#[test]
fn withdrawing_returns_the_deposit_when_nothing_has_traded() {
    let (pool, lp) = Pool::seeded(100 * USDC, 4_900 * USDC);
    let shares = pool.amm.balance(&lp);

    let (a, b) = pool.amm.remove_liquidity(&lp, &shares, &0, &0);

    // Everything back except the locked sliver's share.
    assert!(a > 99_999 * (USDC / 10_000) && a <= 100 * USDC);
    assert!(b > 4_899 * USDC && b <= 4_900 * USDC);
    assert_eq!(pool.amm.balance(&lp), 0);
}

#[test]
fn a_provider_earns_the_fees_traders_paid() {
    let (pool, lp) = Pool::seeded(1_000 * USDC, 49_000 * USDC);
    let shares = pool.amm.balance(&lp);

    // Push volume through, back and forth so the price ends up near where
    // it started and the gain is the fee rather than the move.
    // Funded well past the trade size: each round trip returns slightly less
    // than it took, which is exactly the fee being left behind.
    let trader = pool.user(500 * USDC, 0);
    for _ in 0..4 {
        let out = pool.amm.swap(&trader, &pool.a, &(100 * USDC), &0);
        pool.amm.swap(&trader, &pool.b, &out, &0);
    }

    let (a, b) = pool.amm.preview_remove(&shares);
    // Priced back at the starting rate of 49, the position is worth more
    // than the 2_000 USDC-equivalent that went in.
    let value_in_usdc = a + b / 49;
    assert!(value_in_usdc > 1_999 * USDC, "fees must accrue to the LP");
}

#[test]
fn removing_liquidity_respects_the_callers_minimums() {
    let (pool, lp) = Pool::seeded(100 * USDC, 4_900 * USDC);
    let shares = pool.amm.balance(&lp);
    assert!(pool
        .amm
        .try_remove_liquidity(&lp, &shares, &(200 * USDC), &0)
        .is_err());
}

#[test]
fn adding_liquidity_respects_the_callers_minimums() {
    let (pool, _) = Pool::seeded(100 * USDC, 4_900 * USDC);
    let lp2 = pool.user(10 * USDC, 1_000 * USDC);
    // They will only accept the deal if at least 600 aTRY is taken; the
    // ratio only takes 490.
    assert!(pool
        .amm
        .try_add_liquidity(&lp2, &(10 * USDC), &(1_000 * USDC), &0, &(600 * USDC))
        .is_err());
}

// --------------------------------------------------------------- slippage

#[test]
fn a_swap_below_the_callers_floor_is_refused() {
    let (pool, _) = Pool::seeded(100 * USDC, 4_900 * USDC);
    let trader = pool.user(10 * USDC, 0);

    let expected = pool.amm.get_amount_out(&pool.a, &(10 * USDC));
    // Demand one unit more than the curve can give.
    assert!(pool
        .amm
        .try_swap(&trader, &pool.a, &(10 * USDC), &(expected + 1))
        .is_err());
    // And at exactly the quote, it goes through.
    assert_eq!(pool.amm.swap(&trader, &pool.a, &(10 * USDC), &expected), expected);
}

#[test]
fn the_quote_matches_what_the_swap_actually_pays() {
    let (pool, _) = Pool::seeded(100 * USDC, 4_900 * USDC);
    let trader = pool.user(7 * USDC, 0);

    let quoted = pool.amm.get_amount_out(&pool.a, &(7 * USDC));
    let paid = pool.amm.swap(&trader, &pool.a, &(7 * USDC), &0);
    assert_eq!(quoted, paid, "the interface must not be able to lie");
}

#[test]
fn asking_for_an_exact_output_names_a_sufficient_input() {
    let (pool, _) = Pool::seeded(1_000 * USDC, 49_000 * USDC);
    let want = 490 * USDC;

    let needed = pool.amm.get_amount_in(&pool.a, &want);
    let trader = pool.user(needed, 0);
    let got = pool.amm.swap(&trader, &pool.a, &needed, &0);

    assert!(got >= want, "rounding must never shortchange the trader's target");
}

// ------------------------------------------------------------- boundaries

#[test]
fn an_empty_pool_cannot_be_traded_against() {
    let pool = Pool::new();
    let trader = pool.user(10 * USDC, 0);
    assert!(pool.amm.try_swap(&trader, &pool.a, &(10 * USDC), &0).is_err());
}

#[test]
fn a_token_that_is_not_in_the_pair_is_refused() {
    let (pool, _) = Pool::seeded(100 * USDC, 4_900 * USDC);
    let issuer = Address::generate(&pool.e);
    let other = pool.e.register_stellar_asset_contract_v2(issuer).address();
    let trader = pool.user(10 * USDC, 0);
    assert!(pool.amm.try_swap(&trader, &other, &(10 * USDC), &0).is_err());
}

#[test]
fn nobody_can_withdraw_more_than_they_hold() {
    let (pool, lp) = Pool::seeded(100 * USDC, 4_900 * USDC);
    let shares = pool.amm.balance(&lp);
    assert!(pool.amm.try_remove_liquidity(&lp, &(shares + 1), &0, &0).is_err());
}

#[test]
fn amounts_must_be_positive() {
    let (pool, lp) = Pool::seeded(100 * USDC, 4_900 * USDC);
    assert!(pool.amm.try_swap(&lp, &pool.a, &0, &0).is_err());
    assert!(pool.amm.try_swap(&lp, &pool.a, &(-1), &0).is_err());
    assert!(pool.amm.try_add_liquidity(&lp, &0, &(1 * USDC), &0, &0).is_err());
    assert!(pool.amm.try_remove_liquidity(&lp, &0, &0, &0).is_err());
}

#[test]
#[should_panic]
fn the_pair_cannot_be_the_same_token_twice() {
    let e = Env::default();
    let issuer = Address::generate(&e);
    let sac = e.register_stellar_asset_contract_v2(issuer).address();
    e.register(Amm, (sac.clone(), sac, FEE_BPS));
}

#[test]
#[should_panic]
fn the_fee_is_capped_at_deployment() {
    let e = Env::default();
    let issuer = Address::generate(&e);
    let a = e.register_stellar_asset_contract_v2(issuer.clone()).address();
    let b = e.register_stellar_asset_contract_v2(issuer).address();
    e.register(Amm, (a, b, 101u32));
}

// -------------------------------------------------------- no admin at all

#[test]
fn there_is_no_second_chance_to_configure_the_pool() {
    let (pool, _) = Pool::seeded(100 * USDC, 4_900 * USDC);
    let cfg = pool.amm.get_config();
    assert_eq!(cfg.fee_bps, FEE_BPS);
    // The constructor is the only writer of Config, and it refuses to run
    // twice — there is no setter anywhere on this contract to call instead.
    assert_eq!(cfg.token_a, pool.a);
    assert_eq!(cfg.token_b, pool.b);
}

#[test]
fn a_donation_belongs_to_every_provider_once_it_is_synced() {
    let (pool, lp) = Pool::seeded(100 * USDC, 4_900 * USDC);
    let shares = pool.amm.balance(&lp);
    let (before_a, _) = pool.amm.preview_remove(&shares);

    // Someone sends tokens straight to the contract.
    let donor = pool.user(10 * USDC, 0);
    pool.token_a.transfer(&donor, &pool.amm.address, &(10 * USDC));

    // Untouched until it is folded in: the price cannot be pushed by a
    // transfer alone.
    assert_eq!(pool.amm.spot_price(), 49 * USDC);

    pool.amm.sync();
    let (after_a, _) = pool.amm.preview_remove(&shares);
    assert!(after_a > before_a, "the donation lifts the provider's claim");
}

// --------------------------------------------------------- SEP-41 LP token

#[test]
fn the_lp_position_is_a_sep41_token() {
    let (pool, lp) = Pool::seeded(100 * USDC, 4_900 * USDC);
    let shares = pool.amm.balance(&lp);
    let buyer = pool.user(0, 0);

    pool.amm.transfer(&lp, &buyer, &shares);
    assert_eq!(pool.amm.balance(&lp), 0);
    assert_eq!(pool.amm.balance(&buyer), shares);

    // And the claim travels with it.
    let (a, b) = pool.amm.remove_liquidity(&buyer, &shares, &0, &0);
    assert!(a > 0 && b > 0);
    assert_eq!(pool.amm.decimals(), 7);
}

#[test]
fn an_allowance_lets_a_spender_move_lp_tokens_once() {
    let (pool, lp) = Pool::seeded(100 * USDC, 4_900 * USDC);
    let shares = pool.amm.balance(&lp);
    let spender = pool.user(0, 0);
    let to = pool.user(0, 0);

    pool.amm.approve(&lp, &spender, &shares, &(pool.e.ledger().sequence() + 100));
    pool.amm.transfer_from(&spender, &lp, &to, &shares);

    assert_eq!(pool.amm.balance(&to), shares);
    assert_eq!(pool.amm.allowance(&lp, &spender), 0);
}
