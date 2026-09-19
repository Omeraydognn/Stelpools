import assert from "node:assert/strict";
import { test } from "node:test";

import type { Sep6Transaction } from "../src/anchor.js";
import { assess } from "../src/eligibility.js";

const ACCOUNT = "GA7U44AD6DMFRS33BXS7N63QSDMIHJRODKD24QWNVZGF2YXQNNU5XSX7";
const OTHER = "GCIPH7PLMGMQPM47U4HM5W6LTSNTNAHBFPBBVO65ALZ72DDR3YV52ZCS";

const deposit = (over: Partial<Sep6Transaction> = {}): Sep6Transaction => ({
  id: "sep_1",
  kind: "deposit",
  status: "pending_anchor",
  amount_in: "1000",
  amount_out: "20.4",
  to: ACCOUNT,
  ...over,
});

test("a pending deposit for this account is frontable", () => {
  const v = assess(deposit(), ACCOUNT, 100, 0n);
  assert.equal(v.ok, true);
  assert.equal(v.amountStroops, 204_000_000n); // 20.4 USDC
});

test("somebody else's deposit is refused", () => {
  const v = assess(deposit({ to: OTHER }), ACCOUNT, 100, 0n);
  assert.equal(v.ok, false);
  assert.match(v.reason!, /başka bir hesaba/);
});

test("a withdrawal is not a deposit", () => {
  const v = assess(deposit({ kind: "withdrawal" }), ACCOUNT, 100, 0n);
  assert.equal(v.ok, false);
});

test("a deposit the anchor has not accepted yet is refused", () => {
  for (const status of ["incomplete", "error", "refunded", "expired"]) {
    const v = assess(deposit({ status }), ACCOUNT, 100, 0n);
    assert.equal(v.ok, false, status);
    assert.match(v.reason!, new RegExp(status));
  }
});

test("an account with an open advance cannot take another", () => {
  const v = assess(deposit(), ACCOUNT, 100, 1n);
  assert.equal(v.ok, false);
  assert.match(v.reason!, /kapatılmamış/);
});

test("the relay's own ceiling applies on top of the contract's", () => {
  const v = assess(deposit({ amount_out: "250" }), ACCOUNT, 100, 0n);
  assert.equal(v.ok, false);
  assert.match(v.reason!, /en fazla 100 USDC/);
});

test("a deposit with no quoted amount is refused", () => {
  for (const amount_out of [undefined, "0", "not-a-number"]) {
    const v = assess(deposit({ ...(amount_out ? { amount_out } : {}) } as Sep6Transaction), ACCOUNT, 100, 0n);
    if (amount_out === undefined) {
      const stripped = deposit();
      delete stripped.amount_out;
      assert.equal(assess(stripped, ACCOUNT, 100, 0n).ok, false);
    } else {
      assert.equal(v.ok, false, String(amount_out));
    }
  }
});

test("a completed deposit is still frontable — the race is the point", () => {
  // The anchor may flip to completed while the request is in flight; the
  // vault is repaid from the same USDC either way.
  assert.equal(assess(deposit({ status: "completed" }), ACCOUNT, 100, 0n).ok, true);
});
