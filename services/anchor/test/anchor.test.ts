import assert from "node:assert/strict";
import { test } from "node:test";

import { loadConfig } from "../src/config.js";
import { Store } from "../src/db.js";
import { accountOf, issue, verify } from "../src/jwt.js";
import { code, quoteDeposit, quoteWithdraw, reference } from "../src/seps.js";
import { isMissingTrustline, isRetryable, memoFor } from "../src/stellar.js";

const SECRET = "a".repeat(40);
const ACCOUNT = "GAJYF5I7IJLPLIZKLUVNZOH5TPL2XLQYTENZT4RI7X6HBRDJ5NKPYJBP";

// ------------------------------------------------------------------- JWT

test("a token round-trips and names the account it speaks for", () => {
  const now = Math.floor(Date.now() / 1000);
  const token = issue({ sub: ACCOUNT, iss: "test", iat: now, exp: now + 60 }, SECRET);
  const claims = verify(token, SECRET);
  assert.ok(claims);
  assert.equal(accountOf(claims), ACCOUNT);
});

test("a memo-suffixed subject still resolves to the account", () => {
  const now = Math.floor(Date.now() / 1000);
  const token = issue({ sub: `${ACCOUNT}:1234`, iss: "test", iat: now, exp: now + 60 }, SECRET);
  assert.equal(accountOf(verify(token, SECRET)!), ACCOUNT);
});

test("a token signed with another secret is refused", () => {
  const now = Math.floor(Date.now() / 1000);
  const token = issue({ sub: ACCOUNT, iss: "test", iat: now, exp: now + 60 }, SECRET);
  assert.equal(verify(token, "b".repeat(40)), null);
});

test("alg:none does not get in", () => {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({ sub: ACCOUNT, iss: "test", iat: now, exp: now + 60 }),
  ).toString("base64url");
  assert.equal(verify(`${header}.${payload}.`, SECRET), null);
});

test("a tampered payload is refused", () => {
  const now = Math.floor(Date.now() / 1000);
  const token = issue({ sub: ACCOUNT, iss: "test", iat: now, exp: now + 60 }, SECRET);
  const [h, , s] = token.split(".");
  const forged = Buffer.from(
    JSON.stringify({ sub: "GOTHER", iss: "test", iat: now, exp: now + 60 }),
  ).toString("base64url");
  assert.equal(verify(`${h}.${forged}.${s}`, SECRET), null);
});

test("an expired token is refused", () => {
  const now = Math.floor(Date.now() / 1000);
  const token = issue({ sub: ACCOUNT, iss: "test", iat: now - 120, exp: now - 60 }, SECRET);
  assert.equal(verify(token, SECRET), null);
});

// ----------------------------------------------------------------- ledger

function store(): Store {
  return new Store(":memory:");
}

function deposit(s: Store, id = "dep_TEST0001") {
  return s.insertTx({
    id,
    kind: "deposit",
    account: ACCOUNT,
    status: "pending_user_transfer_start",
    amount_in: "1000.00",
    amount_out: "1000.0000000",
    amount_fee: "0.0000000",
    reference: `STP-${id.slice(-4)}-AAAA`,
    memo: null,
    external_transaction_id: null,
    stellar_transaction_id: null,
    message: null,
  });
}

test("a deposit is written and read back whole", () => {
  const s = store();
  const tx = deposit(s);
  assert.equal(tx.status, "pending_user_transfer_start");
  assert.equal(s.tx(tx.id)?.amount_out, "1000.0000000");
  assert.equal(s.txByReference(tx.reference!)?.id, tx.id);
  s.close();
});

test("a job can only be claimed once — this is what stops a double payout", () => {
  const s = store();
  const tx = deposit(s);
  s.claim(tx.id, "pending_user_transfer_start", "pending_anchor");

  // Two workers, or one worker twice after a restart.
  assert.equal(s.claim(tx.id, "pending_anchor", "submitting"), true);
  assert.equal(s.claim(tx.id, "pending_anchor", "submitting"), false);
  assert.equal(s.tx(tx.id)?.status, "submitting");
  s.close();
});

test("claiming from the wrong state does nothing at all", () => {
  const s = store();
  const tx = deposit(s);
  assert.equal(s.claim(tx.id, "pending_anchor", "completed"), false);
  assert.equal(s.tx(tx.id)?.status, "pending_user_transfer_start");
  s.close();
});

test("only deposits whose lira has arrived are due for payout", () => {
  const s = store();
  const waiting = deposit(s, "dep_WAITING001");
  const ready = deposit(s, "dep_READY00001");
  s.claim(ready.id, "pending_user_transfer_start", "pending_anchor");

  const due = s.duePayouts().map((t) => t.id);
  assert.deepEqual(due, [ready.id]);
  assert.ok(!due.includes(waiting.id));
  s.close();
});

test("a backed-off job is not picked up before its time", () => {
  const s = store();
  const tx = deposit(s);
  s.claim(tx.id, "pending_user_transfer_start", "pending_anchor");
  s.update(tx.id, { next_attempt_at: new Date(Date.now() + 60_000).toISOString() });

  assert.equal(s.duePayouts().length, 0);
  assert.equal(s.duePayouts(new Date(Date.now() + 120_000)).length, 1);
  s.close();
});

test("a payout interrupted mid-submit is found again after a restart", () => {
  const s = store();
  const tx = deposit(s);
  s.claim(tx.id, "pending_user_transfer_start", "pending_anchor");
  s.claim(tx.id, "pending_anchor", "submitting");

  // The process dies here. Whatever restarts must see this row.
  const stranded = s.strandedPayouts();
  assert.equal(stranded.length, 1);
  assert.equal(stranded[0]!.id, tx.id);
  s.close();
});

test("the same reference cannot be handed out twice", () => {
  const s = store();
  deposit(s, "dep_FIRST00001");
  assert.throws(() =>
    s.insertTx({
      id: "dep_SECOND0001",
      kind: "deposit",
      account: ACCOUNT,
      status: "pending_user_transfer_start",
      amount_in: "1.00",
      amount_out: "1.0000000",
      amount_fee: "0",
      reference: "STP-0001-AAAA", // the one dep_FIRST00001 already holds
      memo: null,
      external_transaction_id: null,
      stellar_transaction_id: null,
      message: null,
    }),
  );
  s.close();
});

test("a withdrawal is found by the memo the user must quote", () => {
  const s = store();
  s.insertTx({
    id: "wdr_TEST0001",
    kind: "withdrawal",
    account: ACCOUNT,
    status: "pending_user_transfer_start",
    amount_in: "500.0000000",
    amount_out: "500.00",
    amount_fee: "0",
    reference: null,
    memo: memoFor("wdr_TEST0001"),
    external_transaction_id: null,
    stellar_transaction_id: null,
    message: null,
  });
  assert.equal(s.txByMemo("wdr_TEST0001")?.kind, "withdrawal");
  s.close();
});

test("the watcher remembers where it stopped reading", () => {
  const s = store();
  assert.equal(s.cursor("burns"), null);
  s.setCursor("burns", "12345-1");
  s.setCursor("burns", "12345-2");
  assert.equal(s.cursor("burns"), "12345-2");
  s.close();
});

// ------------------------------------------------------------------ money

const cfg = loadConfig({
  SEP10_SIGNING_SECRET: "S" + "A".repeat(55),
  ATRY_ISSUER_SECRET: "S" + "B".repeat(55),
  JWT_SECRET: SECRET,
} as NodeJS.ProcessEnv);

test("one aTRY is one lira", () => {
  assert.equal(quoteDeposit(cfg, 1000).out, "1000.0000000");
  assert.equal(quoteDeposit(cfg, 1000).fee, "0.0000000");
});

test("a fee, when configured, comes off the amount rather than being added", () => {
  const withFee = loadConfig({
    SEP10_SIGNING_SECRET: "S" + "A".repeat(55),
    ATRY_ISSUER_SECRET: "S" + "B".repeat(55),
    JWT_SECRET: SECRET,
    FEE_BPS: "100",
  } as NodeJS.ProcessEnv);
  assert.equal(quoteDeposit(withFee, 1000).out, "990.0000000");
  assert.equal(quoteWithdraw(withFee, 1000).out, "990.00");
});

test("the two keys must not be the same", () => {
  assert.throws(() =>
    loadConfig({
      SEP10_SIGNING_SECRET: "S" + "A".repeat(55),
      ATRY_ISSUER_SECRET: "S" + "A".repeat(55),
      JWT_SECRET: SECRET,
    } as NodeJS.ProcessEnv),
  );
});

test("a short JWT secret is refused outright", () => {
  assert.throws(() =>
    loadConfig({
      SEP10_SIGNING_SECRET: "S" + "A".repeat(55),
      ATRY_ISSUER_SECRET: "S" + "B".repeat(55),
      JWT_SECRET: "too-short",
    } as NodeJS.ProcessEnv),
  );
});

// ------------------------------------------------------------- identifiers

test("a memo always fits Stellar's 28 bytes", () => {
  assert.ok(Buffer.byteLength(memoFor("dep_ABCDEFGHJKLM")) <= 28);
  assert.ok(Buffer.byteLength(memoFor("x".repeat(80))) <= 28);
});

test("references are readable off a screen", () => {
  assert.match(reference(), /^STP-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
  // No characters a person could confuse while retyping a bank description.
  assert.ok(!/[O0I1]/.test(code(200)));
});

// -------------------------------------------------------- failure triage

test("a missing trustline is the user's to fix, not ours to retry around", () => {
  const err = {
    response: { data: { extras: { result_codes: { operations: ["op_no_trust"] } } } },
  };
  assert.equal(isMissingTrustline(err), true);
});

test("a malformed transaction is never retried", () => {
  const err = {
    response: { data: { extras: { result_codes: { transaction: "tx_failed", operations: ["op_malformed"] } } } },
  };
  assert.equal(isRetryable(err), false);
});

test("a raced sequence number is retried", () => {
  const err = { response: { data: { extras: { result_codes: { transaction: "tx_bad_seq" } } } } };
  assert.equal(isRetryable(err), true);
});

test("a network error with no result codes is retried", () => {
  assert.equal(isRetryable(new Error("socket hang up")), true);
});
