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
//
// These need a real Postgres, because what they are testing is Postgres
// behaviour: that a conditional UPDATE is the thing which makes a double
// payout impossible. A fake would prove nothing. Point TEST_DATABASE_URL at
// a throwaway database to run them.

const TEST_DB = process.env.TEST_DATABASE_URL;
const needsDb = { skip: TEST_DB ? false : "set TEST_DATABASE_URL to run the ledger tests" };

async function freshStore(): Promise<Store> {
  const s = new Store(TEST_DB!);
  await s.init();
  // Start from empty: these assert on counts and uniqueness.
  await s.withClient(async (c) => {
    await c.query("TRUNCATE transactions, customers, cursors");
  });
  return s;
}

function depositFields(id = "dep_TEST0001") {
  return {
    id,
    kind: "deposit" as const,
    account: ACCOUNT,
    status: "pending_user_transfer_start" as const,
    amount_in: "1000.00",
    amount_out: "1000.0000000",
    amount_fee: "0.0000000",
    reference: `STP-${id.slice(-4)}-AAAA`,
    memo: null,
    external_transaction_id: null,
    stellar_transaction_id: null,
    message: null,
  };
}

test("a deposit is written and read back whole", needsDb, async () => {
  const s = await freshStore();
  const tx = await s.insertTx(depositFields());
  assert.equal(tx.status, "pending_user_transfer_start");
  assert.equal((await s.tx(tx.id))?.amount_out, "1000.0000000");
  assert.equal((await s.txByReference(tx.reference!))?.id, tx.id);
  await s.close();
});

test("a job can only be claimed once — this is what stops a double payout", needsDb, async () => {
  const s = await freshStore();
  const tx = await s.insertTx(depositFields());
  await s.claim(tx.id, "pending_user_transfer_start", "pending_anchor");

  // Two workers, or one worker twice, or two copies of the whole process.
  assert.equal(await s.claim(tx.id, "pending_anchor", "submitting"), true);
  assert.equal(await s.claim(tx.id, "pending_anchor", "submitting"), false);
  assert.equal((await s.tx(tx.id))?.status, "submitting");
  await s.close();
});

test("two claims racing in parallel: exactly one wins", needsDb, async () => {
  const s = await freshStore();
  const tx = await s.insertTx(depositFields());
  await s.claim(tx.id, "pending_user_transfer_start", "pending_anchor");

  const results = await Promise.all(
    Array.from({ length: 8 }, () => s.claim(tx.id, "pending_anchor", "submitting")),
  );
  assert.equal(results.filter(Boolean).length, 1, "exactly one caller may own the job");
  await s.close();
});

test("claiming from the wrong state does nothing at all", needsDb, async () => {
  const s = await freshStore();
  const tx = await s.insertTx(depositFields());
  assert.equal(await s.claim(tx.id, "pending_anchor", "completed"), false);
  assert.equal((await s.tx(tx.id))?.status, "pending_user_transfer_start");
  await s.close();
});

test("only deposits whose lira has arrived are due for payout", needsDb, async () => {
  const s = await freshStore();
  const waiting = await s.insertTx(depositFields("dep_WAITING001"));
  const ready = await s.insertTx(depositFields("dep_READY00001"));
  await s.claim(ready.id, "pending_user_transfer_start", "pending_anchor");

  const due = (await s.duePayouts()).map((t) => t.id);
  assert.deepEqual(due, [ready.id]);
  assert.ok(!due.includes(waiting.id));
  await s.close();
});

test("a backed-off job is not picked up before its time", needsDb, async () => {
  const s = await freshStore();
  const tx = await s.insertTx(depositFields());
  await s.claim(tx.id, "pending_user_transfer_start", "pending_anchor");
  await s.update(tx.id, { next_attempt_at: new Date(Date.now() + 60_000).toISOString() });

  assert.equal((await s.duePayouts()).length, 0);
  assert.equal((await s.duePayouts(new Date(Date.now() + 120_000))).length, 1);
  await s.close();
});

test("a payout interrupted mid-submit is found again later", needsDb, async () => {
  const s = await freshStore();
  const tx = await s.insertTx(depositFields());
  await s.claim(tx.id, "pending_user_transfer_start", "pending_anchor");
  await s.claim(tx.id, "pending_anchor", "submitting");

  // Fresh, so not yet assumed abandoned.
  assert.equal((await s.strandedPayouts()).length, 0);
  // Old enough that nothing legitimate is still there.
  const stranded = await s.strandedPayouts(-1);
  assert.equal(stranded.length, 1);
  assert.equal(stranded[0]!.id, tx.id);
  await s.close();
});

test("the same reference cannot be handed out twice", needsDb, async () => {
  const s = await freshStore();
  await s.insertTx(depositFields("dep_FIRST00001"));
  await assert.rejects(() =>
    s.insertTx({ ...depositFields("dep_SECOND0001"), reference: "STP-0001-AAAA" }),
  );
  await s.close();
});

test("a withdrawal is found by the memo the user must quote", needsDb, async () => {
  const s = await freshStore();
  await s.insertTx({
    ...depositFields("wdr_TEST0001"),
    kind: "withdrawal",
    reference: null,
    memo: memoFor("wdr_TEST0001"),
  });
  assert.equal((await s.txByMemo("wdr_TEST0001"))?.kind, "withdrawal");
  await s.close();
});

test("the watcher remembers where it stopped reading", needsDb, async () => {
  const s = await freshStore();
  assert.equal(await s.cursor("burns"), null);
  await s.setCursor("burns", "12345-1");
  await s.setCursor("burns", "12345-2");
  assert.equal(await s.cursor("burns"), "12345-2");
  await s.close();
});

// ------------------------------------------------------------------ money

const baseEnv = {
  SEP10_SIGNING_SECRET: "S" + "A".repeat(55),
  ATRY_ISSUER_SECRET: "S" + "B".repeat(55),
  JWT_SECRET: SECRET,
  DATABASE_URL: "postgres://user:pw@localhost:5432/anchor",
} as NodeJS.ProcessEnv;

const cfg = loadConfig(baseEnv);

test("one aTRY is one lira", () => {
  assert.equal(quoteDeposit(cfg, 1000).out, "1000.0000000");
  assert.equal(quoteDeposit(cfg, 1000).fee, "0.0000000");
});

test("a fee, when configured, comes off the amount rather than being added", () => {
  const withFee = loadConfig({ ...baseEnv, FEE_BPS: "100" } as NodeJS.ProcessEnv);
  assert.equal(quoteDeposit(withFee, 1000).out, "990.0000000");
  assert.equal(quoteWithdraw(withFee, 1000).out, "990.00");
});

test("a ledger is not optional", () => {
  const { DATABASE_URL: _drop, ...noDb } = baseEnv as Record<string, string>;
  assert.throws(() => loadConfig(noDb as NodeJS.ProcessEnv));
});

test("the two keys must not be the same", () => {
  assert.throws(() =>
    loadConfig({ ...baseEnv, ATRY_ISSUER_SECRET: "S" + "A".repeat(55) } as NodeJS.ProcessEnv),
  );
});

test("a short JWT secret is refused outright", () => {
  assert.throws(() => loadConfig({ ...baseEnv, JWT_SECRET: "too-short" } as NodeJS.ProcessEnv));
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
