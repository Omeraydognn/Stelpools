#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token, Address, Env,
};

use crate::{Error, Vault, VaultClient};

const USDC: i128 = 1_0000000; // one USDC in stroops
const FEE_BPS: u32 = 50; // 0.5% withdrawal fee

struct Ctx {
    e: Env,
    vault: VaultClient<'static>,
    usdc: token::Client<'static>,
    mint: token::StellarAssetClient<'static>,
    admin: Address,
    alice: Address,
    bob: Address,
    relay: Address,
}

fn setup(fee_bps: u32) -> Ctx {
    setup_capped(fee_bps, 0)
}

fn setup_capped(fee_bps: u32, cap: i128) -> Ctx {
    setup_full(fee_bps, cap, 0, 0, 0)
}

/// `max_advance = 0` leaves advances switched off, which is the default.
fn setup_full(
    fee_bps: u32,
    cap: i128,
    max_advance: i128,
    advance_cap: i128,
    advance_fee_bps: u32,
) -> Ctx {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let alice = Address::generate(&e);
    let bob = Address::generate(&e);

    let sac = e.register_stellar_asset_contract_v2(admin.clone());
    let mint = token::StellarAssetClient::new(&e, &sac.address());
    for account in [&admin, &alice, &bob] {
        mint.mint(account, &(1_000 * USDC));
    }

    let relay = Address::generate(&e);
    let id = e.register(
        Vault,
        (
            admin.clone(),
            sac.address(),
            fee_bps,
            cap,
            relay.clone(),
            max_advance,
            advance_cap,
            advance_fee_bps,
        ),
    );

    Ctx {
        vault: VaultClient::new(&e, &id),
        usdc: token::Client::new(&e, &sac.address()),
        mint,
        e,
        admin,
        alice,
        bob,
        relay,
    }
}

fn err(e: Error) -> soroban_sdk::Error {
    e.into()
}

// ---------------------------------------------------------------- deposits

const LOCKED: i128 = 1_000_000; // 0.1 share, locked in the vault forever

#[test]
fn the_first_deposit_mints_one_share_per_unit_less_the_locked_sliver() {
    let c = setup(0);
    let shares = c.vault.deposit(&c.alice, &(100 * USDC));

    assert_eq!(shares, 100 * USDC - LOCKED);
    assert_eq!(c.vault.balance_of(&c.alice), 100 * USDC - LOCKED);
    // The locked shares belong to the vault itself and are never redeemed.
    assert_eq!(c.vault.balance(&c.vault.address), LOCKED);
    assert_eq!(c.vault.total_shares(), 100 * USDC);
    assert_eq!(c.vault.total_assets(), 100 * USDC);
    assert_eq!(c.vault.share_price(), 1_0000000);
}

#[test]
fn supply_never_returns_to_zero_so_the_last_fee_always_has_an_owner() {
    let c = setup(FEE_BPS);
    let shares = c.vault.deposit(&c.alice, &(100 * USDC));
    c.vault.withdraw(&c.alice, &shares);

    // Alice is out, but the locked shares remain and hold the fee she paid.
    assert_eq!(c.vault.balance_of(&c.alice), 0);
    assert_eq!(c.vault.total_shares(), LOCKED);
    assert!(c.vault.total_assets() > 0);
    assert!(c.vault.share_price() > 1_0000000);
}

#[test]
fn a_second_depositor_gets_shares_at_the_current_price() {
    let c = setup(0);
    c.vault.deposit(&c.alice, &(100 * USDC));
    let bob_shares = c.vault.deposit(&c.bob, &(50 * USDC));

    assert_eq!(bob_shares, 50 * USDC); // price is still 1.0
    assert_eq!(c.vault.total_assets(), 150 * USDC);
    assert_eq!(c.vault.preview_withdraw(&bob_shares), 50 * USDC);
}

#[test]
fn a_tiny_first_deposit_is_refused() {
    let c = setup(0);
    // Opening a vault with dust is how share pricing gets attacked.
    assert_eq!(
        c.vault.try_deposit(&c.alice, &1).unwrap_err().unwrap(),
        err(Error::BelowMinimumDeposit)
    );
    c.vault.deposit(&c.alice, &USDC); // exactly the minimum is fine
}

#[test]
fn deposits_must_be_positive() {
    let c = setup(0);
    assert_eq!(
        c.vault.try_deposit(&c.alice, &0).unwrap_err().unwrap(),
        err(Error::InvalidAmount)
    );
}

// ----------------------------------------------------------------- yield

#[test]
fn a_donation_lifts_every_share() {
    let c = setup(0);
    c.vault.deposit(&c.alice, &(100 * USDC));

    // 10 USDC of yield arrives without minting shares.
    c.vault.donate(&c.bob, &(10 * USDC));

    assert_eq!(c.vault.total_assets(), 110 * USDC);
    assert_eq!(c.vault.share_price(), 1_1000000); // 1.10 USDC per share
    assert_eq!(c.vault.preview_withdraw(&(100 * USDC)), 110 * USDC);
}

#[test]
fn yield_earned_before_a_deposit_is_not_shared_with_the_new_depositor() {
    let c = setup(0);
    c.vault.deposit(&c.alice, &(100 * USDC));
    c.vault.donate(&c.admin, &(100 * USDC)); // price doubles to 2.0

    let bob_shares = c.vault.deposit(&c.bob, &(100 * USDC));
    assert_eq!(bob_shares, 50 * USDC); // half the shares for the same money

    // Alice keeps all the yield that accrued before Bob arrived.
    assert_eq!(c.vault.preview_withdraw(&(100 * USDC)), 200 * USDC);
    assert_eq!(c.vault.preview_withdraw(&bob_shares), 100 * USDC);
}

#[test]
fn a_direct_transfer_into_the_vault_counts_as_yield() {
    let c = setup(0);
    c.vault.deposit(&c.alice, &(100 * USDC));
    // No donate() call — just USDC appearing, as a strategy's return would.
    c.mint.mint(&c.vault.address, &(50 * USDC));
    assert_eq!(c.vault.share_price(), 1_5000000);
}

// ------------------------------------------------------------- withdrawals

#[test]
fn withdrawing_returns_the_deposit_when_nothing_has_changed() {
    let c = setup(0);
    let before = c.usdc.balance(&c.alice);
    let shares = c.vault.deposit(&c.alice, &(100 * USDC));

    let paid = c.vault.withdraw(&c.alice, &shares);

    // Everything except the sliver locked at bootstrap.
    assert_eq!(paid, 100 * USDC - LOCKED);
    assert_eq!(c.usdc.balance(&c.alice), before - LOCKED);
    assert_eq!(c.vault.balance_of(&c.alice), 0);
    assert_eq!(c.vault.total_shares(), LOCKED);
}

#[test]
fn a_partial_withdrawal_leaves_the_rest_earning() {
    let c = setup(0);
    let shares = c.vault.deposit(&c.alice, &(100 * USDC));
    c.vault.withdraw(&c.alice, &(shares / 4));

    // Three quarters of her shares, and the assets behind them, stay put.
    assert_eq!(c.vault.balance_of(&c.alice), (100 * USDC - LOCKED) - (100 * USDC - LOCKED) / 4);
    assert!((c.vault.total_assets() - 75 * USDC).abs() < USDC / 10);
}

#[test]
fn the_withdrawal_fee_stays_with_the_depositors_who_remain() {
    let c = setup(FEE_BPS);
    let alice_shares = c.vault.deposit(&c.alice, &(100 * USDC));
    let bob_shares = c.vault.deposit(&c.bob, &(100 * USDC));
    let bob_worth_before = c.vault.preview_withdraw(&bob_shares);

    let paid = c.vault.withdraw(&c.alice, &alice_shares);

    // Alice pays 0.5% on the way out; the fee stays behind.
    assert_eq!(paid, alice_shares - alice_shares * 50 / 10_000);
    assert!(c.vault.share_price() > 1_0000000);
    // Bob did nothing and is better off for it.
    assert!(c.vault.preview_withdraw(&bob_shares) > bob_worth_before);
}

#[test]
fn withdraw_all_empties_the_position() {
    let c = setup(0);
    c.vault.deposit(&c.alice, &(100 * USDC));
    c.vault.donate(&c.bob, &(20 * USDC));

    assert_eq!(c.vault.withdraw_all(&c.alice), 120 * USDC - LOCKED * 12 / 10);
    assert_eq!(c.vault.balance_of(&c.alice), 0);
}

#[test]
fn nobody_can_withdraw_more_shares_than_they_hold() {
    let c = setup(0);
    let shares = c.vault.deposit(&c.alice, &(100 * USDC));
    assert_eq!(
        c.vault.try_withdraw(&c.alice, &(shares + 1)).unwrap_err().unwrap(),
        err(Error::InsufficientShares)
    );
    assert_eq!(
        c.vault.try_withdraw_all(&c.bob).unwrap_err().unwrap(),
        err(Error::InsufficientShares)
    );
}

#[test]
fn two_depositors_leave_with_exactly_what_they_are_owed() {
    let c = setup(0);
    let alice_before = c.usdc.balance(&c.alice);
    let bob_before = c.usdc.balance(&c.bob);

    let alice_shares = c.vault.deposit(&c.alice, &(300 * USDC));
    let bob_shares = c.vault.deposit(&c.bob, &(100 * USDC));
    c.vault.donate(&c.admin, &(40 * USDC)); // 10% yield on 400

    c.vault.withdraw(&c.alice, &alice_shares);
    c.vault.withdraw(&c.bob, &bob_shares);

    // Each is up 10% on their stake, give or take the locked sliver's share.
    assert!((c.usdc.balance(&c.alice) - (alice_before + 30 * USDC)).abs() < LOCKED * 2);
    assert_eq!(c.usdc.balance(&c.bob), bob_before + 10 * USDC);
    assert_eq!(c.vault.total_shares(), LOCKED);
}

// ------------------------------------------------------------------- admin

#[test]
fn pausing_stops_deposits_but_never_withdrawals() {
    let c = setup(0);
    let shares = c.vault.deposit(&c.alice, &(100 * USDC));

    c.vault.set_paused(&true);
    assert_eq!(
        c.vault.try_deposit(&c.bob, &(10 * USDC)).unwrap_err().unwrap(),
        err(Error::Paused)
    );
    // Money is never trapped by a pause.
    assert_eq!(c.vault.withdraw(&c.alice, &shares), shares);
}

#[test]
fn the_fee_is_capped() {
    let c = setup(0);
    assert_eq!(c.vault.try_set_fee(&501).unwrap_err().unwrap(), err(Error::InvalidFee));
    c.vault.set_fee(&500);
    assert_eq!(c.vault.get_config().withdraw_fee_bps, 500);
}

#[test]
fn admin_actions_need_the_admin_signature() {
    let c = setup(0);
    c.e.set_auths(&[]);
    assert!(c.vault.try_set_fee(&100).is_err());
    assert!(c.vault.try_set_paused(&true).is_err());
}

#[test]
fn a_deposit_needs_the_depositor_signature() {
    let c = setup(0);
    c.e.set_auths(&[]);
    assert!(c.vault.try_deposit(&c.alice, &(10 * USDC)).is_err());
}

#[test]
fn previews_match_what_actually_happens() {
    let c = setup(FEE_BPS);
    // Including the very first deposit, where a sliver is locked away.
    let predicted_shares = c.vault.preview_deposit(&(100 * USDC));
    let shares = c.vault.deposit(&c.alice, &(100 * USDC));
    assert_eq!(shares, predicted_shares);

    c.vault.donate(&c.bob, &(13 * USDC));
    let predicted_payout = c.vault.preview_withdraw(&shares);
    assert_eq!(c.vault.withdraw(&c.alice, &shares), predicted_payout);
}

#[test]
fn an_empty_vault_prices_a_share_at_one() {
    let c = setup(0);
    assert_eq!(c.vault.share_price(), 1_0000000);
    assert_eq!(c.vault.preview_withdraw(&(10 * USDC)), 0);
    assert_eq!(c.vault.total_assets(), 0);
}

// --------------------------------------------------------------- deposit cap

#[test]
fn a_cap_stops_the_vault_growing_past_it() {
    let c = setup_capped(0, 150 * USDC);
    c.vault.deposit(&c.alice, &(100 * USDC));

    assert_eq!(
        c.vault.try_deposit(&c.bob, &(60 * USDC)).unwrap_err().unwrap(),
        err(Error::CapExceeded)
    );
    c.vault.deposit(&c.bob, &(50 * USDC)); // exactly to the cap is fine

    c.vault.set_deposit_cap(&(300 * USDC));
    c.vault.deposit(&c.bob, &(100 * USDC));
    assert_eq!(c.vault.total_assets(), 250 * USDC);
}

#[test]
fn no_cap_means_no_limit() {
    let c = setup(0);
    c.vault.deposit(&c.alice, &(900 * USDC));
    assert_eq!(c.vault.total_assets(), 900 * USDC);
}

// ------------------------------------------------------ shares are a token

#[test]
fn shares_are_a_sep41_token() {
    let c = setup(0);
    assert_eq!(c.vault.symbol(), soroban_sdk::String::from_str(&c.e, "vUSDC"));
    assert_eq!(c.vault.decimals(), 7);

    let shares = c.vault.deposit(&c.alice, &(100 * USDC));
    assert_eq!(c.vault.balance(&c.alice), shares);
    assert_eq!(c.vault.total_shares(), shares + LOCKED);
}

#[test]
fn a_position_can_be_transferred_and_the_recipient_can_withdraw_it() {
    let c = setup(0);
    let bob_before = c.usdc.balance(&c.bob);
    let shares = c.vault.deposit(&c.alice, &(100 * USDC));

    let half = shares / 2;
    c.vault.transfer(&c.alice, &c.bob, &half);

    assert_eq!(c.vault.balance(&c.alice), shares - half);
    assert_eq!(c.vault.balance(&c.bob), half);
    // The shares carry their claim with them: at a price of 1.0, a share
    // redeems for one unit of USDC.
    assert_eq!(c.vault.withdraw(&c.bob, &half), half);
    assert_eq!(c.usdc.balance(&c.bob), bob_before + half);
}

#[test]
fn transferring_more_than_you_hold_fails() {
    let c = setup(0);
    c.vault.deposit(&c.alice, &(10 * USDC));
    assert_eq!(
        c.vault.try_transfer(&c.alice, &c.bob, &(11 * USDC)).unwrap_err().unwrap(),
        err(Error::InsufficientBalance)
    );
}

#[test]
fn an_allowance_lets_a_spender_move_shares_once() {
    let c = setup(0);
    c.vault.deposit(&c.alice, &(100 * USDC));
    let expiry = c.e.ledger().sequence() + 1_000;

    c.vault.approve(&c.alice, &c.bob, &(40 * USDC), &expiry);
    assert_eq!(c.vault.allowance(&c.alice, &c.bob), 40 * USDC);

    c.vault.transfer_from(&c.bob, &c.alice, &c.bob, &(30 * USDC));
    assert_eq!(c.vault.balance(&c.bob), 30 * USDC);
    assert_eq!(c.vault.allowance(&c.alice, &c.bob), 10 * USDC);

    // Only what is left may be spent.
    assert_eq!(
        c.vault
            .try_transfer_from(&c.bob, &c.alice, &c.bob, &(20 * USDC))
            .unwrap_err()
            .unwrap(),
        err(Error::InsufficientAllowance)
    );
}

#[test]
fn an_expired_allowance_reads_as_zero() {
    let c = setup(0);
    c.vault.deposit(&c.alice, &(100 * USDC));
    let expiry = c.e.ledger().sequence() + 10;
    c.vault.approve(&c.alice, &c.bob, &(40 * USDC), &expiry);

    c.e.ledger().set_sequence_number(expiry + 1);
    assert_eq!(c.vault.allowance(&c.alice, &c.bob), 0);
    assert!(c.vault.try_transfer_from(&c.bob, &c.alice, &c.bob, &USDC).is_err());
}

#[test]
fn an_allowance_cannot_be_created_already_expired() {
    let c = setup(0);
    c.e.ledger().set_sequence_number(100);
    assert_eq!(
        c.vault.try_approve(&c.alice, &c.bob, &USDC, &99).unwrap_err().unwrap(),
        err(Error::InvalidExpirationLedger)
    );
    // Zero is always allowed: it is how an allowance is revoked.
    c.vault.approve(&c.alice, &c.bob, &0, &99);
}

#[test]
fn burning_shares_hands_their_value_to_everyone_else() {
    let c = setup(0);
    let alice_shares = c.vault.deposit(&c.alice, &(100 * USDC));
    let bob_shares = c.vault.deposit(&c.bob, &(100 * USDC));
    let supply_before = c.vault.total_shares();
    let bob_worth_before = c.vault.preview_withdraw(&bob_shares);

    // Alice destroys half her position without taking the assets out.
    c.vault.burn(&c.alice, &(alice_shares / 2));

    assert_eq!(c.vault.balance(&c.alice), alice_shares - alice_shares / 2);
    assert_eq!(c.vault.total_shares(), supply_before - alice_shares / 2);
    assert_eq!(c.vault.total_assets(), 200 * USDC);
    // Bob's unchanged shares are now worth more.
    assert!(c.vault.preview_withdraw(&bob_shares) > bob_worth_before);
}

#[test]
fn token_actions_need_the_owner_signature() {
    let c = setup(0);
    c.vault.deposit(&c.alice, &(100 * USDC));
    c.e.set_auths(&[]);
    assert!(c.vault.try_transfer(&c.alice, &c.bob, &USDC).is_err());
    assert!(c.vault.try_approve(&c.alice, &c.bob, &USDC, &10_000).is_err());
    assert!(c.vault.try_burn(&c.alice, &USDC).is_err());
}

#[test]
fn a_preview_of_a_too_small_first_deposit_promises_nothing() {
    let c = setup(0);
    assert_eq!(c.vault.preview_deposit(&1), 0);
    assert_eq!(c.vault.preview_deposit(&USDC), USDC - LOCKED);
}

// ------------------------------------------------------------------ advances

/// 50 USDC per advance, 200 total, 0.3% fee.
fn setup_advances() -> Ctx {
    setup_full(0, 0, 50 * USDC, 200 * USDC, 30)
}

#[test]
fn an_advance_pays_the_user_now_and_records_the_debt() {
    let c = setup_advances();
    c.vault.deposit(&c.alice, &(100 * USDC));
    let bob_before = c.usdc.balance(&c.bob);

    // The relay has seen the anchor accept Bob's deposit and fronts him 20.
    let paid = c.vault.open_advance(&c.bob, &(20 * USDC));

    assert_eq!(paid, 20 * USDC); // he receives the whole amount
    assert_eq!(c.usdc.balance(&c.bob), bob_before + 20 * USDC);
    // …and repays it with 0.3% on top.
    assert_eq!(c.vault.advance_of(&c.bob), 20 * USDC + 20 * USDC * 30 / 10_000);
    assert_eq!(c.vault.advance_principal_of(&c.bob), 20 * USDC);
    assert_eq!(c.vault.total_advanced(), 20 * USDC);
}

#[test]
fn fronting_does_not_move_the_share_price() {
    let c = setup_advances();
    c.vault.deposit(&c.alice, &(100 * USDC));
    let price_before = c.vault.share_price();

    c.vault.open_advance(&c.bob, &(20 * USDC));

    // The USDC left the building but is still owed, so nothing was lost.
    assert_eq!(c.vault.share_price(), price_before);
    assert_eq!(c.vault.total_assets(), 100 * USDC);
    // Only the liquid part shrank.
    assert!(c.vault.liquid_assets() < 100 * USDC);
}

#[test]
fn repayment_closes_the_advance_and_leaves_the_fee_behind() {
    let c = setup_advances();
    c.vault.deposit(&c.alice, &(100 * USDC));
    let price_before = c.vault.share_price();
    c.vault.open_advance(&c.bob, &(20 * USDC));

    // The anchor's USDC lands with Bob and he settles the whole debt.
    let owed = c.vault.advance_of(&c.bob);
    c.vault.repay_advance(&c.bob, &c.bob, &owed);

    assert_eq!(c.vault.advance_of(&c.bob), 0);
    assert_eq!(c.vault.total_advanced(), 0);
    assert_eq!(c.vault.liquid_assets(), c.vault.total_assets());
    // The vault kept the fee, so every share is worth a little more.
    assert!(c.vault.share_price() > price_before);
}

#[test]
fn anybody_can_repay_and_never_more_than_is_owed() {
    let c = setup_advances();
    c.vault.deposit(&c.alice, &(100 * USDC));
    c.vault.open_advance(&c.bob, &(20 * USDC));

    // A third party over-pays; the vault takes only the debt.
    let owed = c.vault.advance_of(&c.bob);
    let taken = c.vault.repay_advance(&c.admin, &c.bob, &(50 * USDC));
    assert_eq!(taken, owed);
    assert_eq!(c.vault.advance_of(&c.bob), 0);
}

#[test]
fn a_partial_repayment_leaves_the_rest_owed() {
    let c = setup_advances();
    c.vault.deposit(&c.alice, &(100 * USDC));
    c.vault.open_advance(&c.bob, &(20 * USDC));

    let owed = c.vault.advance_of(&c.bob);
    c.vault.repay_advance(&c.bob, &c.bob, &(5 * USDC));
    assert_eq!(c.vault.advance_of(&c.bob), owed - 5 * USDC);
    // Principal is retired first, so the vault's exposure drops in step.
    assert_eq!(c.vault.total_advanced(), 15 * USDC);
}

#[test]
fn a_write_off_hits_the_share_price_immediately() {
    let c = setup_advances();
    c.vault.deposit(&c.alice, &(100 * USDC));
    let price_before = c.vault.share_price();
    c.vault.open_advance(&c.bob, &(20 * USDC));

    c.vault.write_off(&c.bob);

    assert_eq!(c.vault.advance_of(&c.bob), 0);
    assert_eq!(c.vault.total_advanced(), 0);
    // Alice carries the loss, visibly.
    assert!(c.vault.share_price() < price_before);
}

#[test]
fn only_the_relay_may_front_money() {
    let c = setup_advances();
    c.vault.deposit(&c.alice, &(100 * USDC));
    c.e.set_auths(&[]);
    assert!(c.vault.try_open_advance(&c.bob, &(10 * USDC)).is_err());
    let _ = &c.relay;
}

#[test]
fn advances_are_off_until_a_limit_is_set() {
    let c = setup(0);
    c.vault.deposit(&c.alice, &(100 * USDC));
    assert_eq!(
        c.vault.try_open_advance(&c.bob, &(10 * USDC)).unwrap_err().unwrap(),
        err(Error::AdvancesDisabled)
    );

    c.vault.set_advance_limits(&(50 * USDC), &(100 * USDC), &30);
    c.vault.open_advance(&c.bob, &(10 * USDC));
    assert_eq!(c.vault.total_advanced(), 10 * USDC);
}

#[test]
fn the_limits_are_enforced() {
    let c = setup_advances();
    c.vault.deposit(&c.alice, &(500 * USDC));

    assert_eq!(
        c.vault.try_open_advance(&c.bob, &(51 * USDC)).unwrap_err().unwrap(),
        err(Error::AdvanceTooLarge)
    );

    c.vault.open_advance(&c.bob, &(20 * USDC));
    assert_eq!(
        c.vault.try_open_advance(&c.bob, &(10 * USDC)).unwrap_err().unwrap(),
        err(Error::AdvanceAlreadyOpen)
    );

    // Fill the book up to the cap, then one more must fail.
    for _ in 0..3 {
        let user = Address::generate(&c.e);
        c.vault.open_advance(&user, &(50 * USDC));
    }
    let late = Address::generate(&c.e);
    assert_eq!(
        c.vault.try_open_advance(&late, &(50 * USDC)).unwrap_err().unwrap(),
        err(Error::AdvanceCapExceeded)
    );
}

#[test]
fn an_advance_cannot_drain_more_than_the_vault_holds() {
    let c = setup_advances();
    c.vault.deposit(&c.alice, &(10 * USDC));
    assert_eq!(
        c.vault.try_open_advance(&c.bob, &(50 * USDC)).unwrap_err().unwrap(),
        err(Error::InsufficientLiquidity)
    );
}

#[test]
fn a_withdrawal_cannot_take_money_that_is_out_on_advance() {
    let c = setup_advances();
    let shares = c.vault.deposit(&c.alice, &(100 * USDC));
    c.vault.open_advance(&c.bob, &(50 * USDC));

    // Alice's shares are still worth 100, but only ~50 is in hand.
    assert_eq!(
        c.vault.try_withdraw(&c.alice, &shares).unwrap_err().unwrap(),
        err(Error::InsufficientLiquidity)
    );
    // What is liquid can still be taken.
    c.vault.withdraw(&c.alice, &(40 * USDC));

    // And once the advance comes back, so does the rest.
    let owed = c.vault.advance_of(&c.bob);
    c.vault.repay_advance(&c.bob, &c.bob, &owed);
    c.vault.withdraw_all(&c.alice);
    assert_eq!(c.vault.balance_of(&c.alice), 0);
}

#[test]
fn repaying_a_debt_that_does_not_exist_is_refused() {
    let c = setup_advances();
    c.vault.deposit(&c.alice, &(100 * USDC));
    assert_eq!(
        c.vault.try_repay_advance(&c.bob, &c.bob, &USDC).unwrap_err().unwrap(),
        err(Error::NoAdvanceOpen)
    );
    assert_eq!(c.vault.try_write_off(&c.bob).unwrap_err().unwrap(), err(Error::NoAdvanceOpen));
}
