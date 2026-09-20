import { Keypair } from "@stellar/stellar-sdk";
import express, { type NextFunction, type Request, type Response } from "express";
import pino from "pino";
import { z } from "zod";

import { loadConfig } from "./config.js";
import { Store, type AnchorTx } from "./db.js";
import { accountOf, issue, verify } from "./jwt.js";
import {
  buildChallenge,
  depositId,
  quoteDeposit,
  quoteWithdraw,
  reference,
  stellarToml,
  verifyChallenge,
  withdrawalId,
} from "./seps.js";
import { StellarOps, memoFor } from "./stellar.js";
import { PayoutWorker } from "./worker.js";

export const cfg = loadConfig();
export const log = pino({
  level: cfg.LOG_LEVEL,
  redact: {
    paths: ["*.jwt", "req.headers.authorization", "*.secret", "*.SECRET"],
    censor: "[redacted]",
  },
});

export const store = new Store(cfg.DATABASE_URL);
export const stellar = new StellarOps(cfg);
export const worker = new PayoutWorker(cfg, store, stellar, log);

/** Derived once, so the TOML and the challenge can never disagree. */
const SIGNING_ADDRESS = Keypair.fromSecret(cfg.SEP10_SIGNING_SECRET).publicKey();

export const app = express();
app.use(express.json({ limit: "64kb" }));

const allowed = new Set(cfg.CORS_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean));
app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.header("origin");
  if (origin && (allowed.has("*") || allowed.has(origin))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
  }
  if (req.method === "OPTIONS") {
    res.sendStatus(origin && (allowed.has("*") || allowed.has(origin)) ? 204 : 403);
    return;
  }
  next();
});

/** Pull the account out of a bearer token, or answer 401 and stop. */
function authed(req: Request, res: Response): string | null {
  const header = req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const claims = token ? verify(token, cfg.JWT_SECRET) : null;
  if (!claims) {
    res.status(401).json({ error: "Missing or expired SEP-10 token." });
    return null;
  }
  return accountOf(claims);
}

/** SEP-6 shows a subset of our columns, under the names the spec uses. */
function present(tx: AnchorTx) {
  return {
    id: tx.id,
    kind: tx.kind,
    status: tx.status === "submitting" ? "pending_anchor" : tx.status,
    status_eta: tx.status === "pending_anchor" ? 10 : undefined,
    amount_in: tx.amount_in ?? undefined,
    amount_in_asset: tx.kind === "deposit" ? "iso4217:TRY" : `stellar:${cfg.ATRY_CODE}`,
    amount_out: tx.amount_out ?? undefined,
    amount_out_asset: tx.kind === "deposit" ? `stellar:${cfg.ATRY_CODE}` : "iso4217:TRY",
    amount_fee: tx.amount_fee ?? undefined,
    to: tx.kind === "deposit" ? tx.account : undefined,
    from: tx.kind === "withdrawal" ? tx.account : undefined,
    external_transaction_id: tx.external_transaction_id ?? undefined,
    stellar_transaction_id: tx.stellar_transaction_id ?? undefined,
    message: tx.message ?? undefined,
    started_at: tx.started_at,
    updated_at: tx.updated_at,
    completed_at: tx.completed_at ?? undefined,
    more_info_url: `${cfg.PUBLIC_URL}/sep6/tx/${tx.id}`,
  };
}

// ------------------------------------------------------------------ health

app.get("/health", async (_req: Request, res: Response) => {
  const [healthy, ledger] = [worker.healthy(), await store.ping()];
  // The worker's liveness is the answer, not the web server's. An anchor
  // whose HTTP is up and whose payouts are dead is the failure mode that
  // matters, and it must not be able to report itself as fine.
  res.status(healthy && ledger.ok ? 200 : 503).json({
    ok: healthy && ledger.ok,
    ledger: ledger.ok ? "reachable" : `unreachable — ${ledger.detail}`,
    worker_mode: cfg.WORKER_MODE,
    service: "stelpools-anchor",
    asset: { code: cfg.ATRY_CODE, issuer: stellar.issuerAddress },
    signing_key: SIGNING_ADDRESS,
    worker: {
      alive: healthy,
      last_tick_at: worker.lastTickAt?.toISOString() ?? null,
      completed: worker.completed,
      failed: worker.failed,
      last_error: worker.lastError,
    },
    time: new Date().toISOString(),
  });
});

// ------------------------------------------------------------------ SEP-1

app.get("/.well-known/stellar.toml", (_req: Request, res: Response) => {
  res.type("text/plain").send(stellarToml(cfg, stellar.issuerAddress, SIGNING_ADDRESS));
});

// ----------------------------------------------------------------- SEP-10

app.get("/auth", (req: Request, res: Response) => {
  const account = String(req.query.account ?? "");
  if (!/^G[A-Z2-7]{55}$/.test(account)) {
    res.status(400).json({ error: "account must be a Stellar public key" });
    return;
  }
  try {
    res.json(buildChallenge(cfg, account));
  } catch (err) {
    log.error({ err }, "could not build a challenge");
    res.status(500).json({ error: "Could not build a challenge." });
  }
});

app.post("/auth", (req: Request, res: Response) => {
  const parsed = z.object({ transaction: z.string().min(20) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "transaction is required" });
    return;
  }
  try {
    const { account } = verifyChallenge(cfg, parsed.data.transaction);
    const now = Math.floor(Date.now() / 1000);
    const token = issue(
      { sub: account, iss: cfg.PUBLIC_URL, iat: now, exp: now + cfg.JWT_TTL_SECONDS },
      cfg.JWT_SECRET,
    );
    res.json({ token });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// ----------------------------------------------------------------- SEP-12

const customerBody = z.object({
  account: z.string().regex(/^G[A-Z2-7]{55}$/).optional(),
  first_name: z.string().max(120).optional(),
  last_name: z.string().max(120).optional(),
  email_address: z.string().email().max(254).optional(),
  bank_account_number: z
    .string()
    .transform((v) => v.replace(/[\s-]/g, "").toUpperCase())
    .refine((v) => /^TR\d{24}$/.test(v), {
      message: "bank_account_number must be a valid Turkish IBAN (TR + 24 digits)",
    })
    .optional(),
  bank_name: z.string().max(120).optional(),
});

app.put("/sep12/customer", async (req: Request, res: Response) => {
  const account = authed(req, res);
  if (!account) return;
  const parsed = customerBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "invalid customer" });
    return;
  }
  const body = parsed.data;
  const existing = await store.customer(account);
  const saved = await store.upsertCustomer({
    account,
    id: existing?.id ?? `cus_${depositId().slice(4)}`,
    first_name: body.first_name ?? null,
    last_name: body.last_name ?? null,
    email_address: body.email_address ?? null,
    bank_account_number: body.bank_account_number ?? null,
    bank_name: body.bank_name ?? null,
    status: "ACCEPTED",
  });
  res.status(202).json({ id: saved.id });
});

app.get("/sep12/customer", async (req: Request, res: Response) => {
  const account = authed(req, res);
  if (!account) return;
  const customer = await store.customer(account);
  if (!customer) {
    res.json({ status: "NEEDS_INFO", fields: { first_name: {}, last_name: {} } });
    return;
  }
  res.json({
    id: customer.id,
    status: customer.status,
    provided_fields: {
      first_name: { status: customer.first_name ? "ACCEPTED" : "NOT_PROVIDED" },
      bank_account_number: {
        status: customer.bank_account_number ? "ACCEPTED" : "NOT_PROVIDED",
      },
    },
  });
});

// ------------------------------------------------------------------ SEP-6

app.get("/sep6/info", (_req: Request, res: Response) => {
  const fields = {
    type: {
      description: "How the lira moves. Only bank_account is supported.",
      choices: ["bank_account"],
      optional: false,
    },
  };
  res.json({
    deposit: {
      [cfg.ATRY_CODE]: {
        enabled: true,
        authentication_required: true,
        fee_percent: cfg.FEE_BPS / 100,
        min_amount: cfg.MIN_DEPOSIT_TRY,
        max_amount: cfg.MAX_DEPOSIT_TRY,
        funding_methods: ["bank_account"],
        fields,
      },
    },
    withdraw: {
      [cfg.ATRY_CODE]: {
        enabled: true,
        authentication_required: true,
        fee_percent: cfg.FEE_BPS / 100,
        funding_methods: ["bank_account"],
        types: { bank_account: { fields: {} } },
      },
    },
    fee: { enabled: false, description: `1 ${cfg.ATRY_CODE} is 1 TRY; only the fee applies.` },
    transactions: { enabled: true, authentication_required: true },
    transaction: { enabled: true, authentication_required: true },
    features: { account_creation: false, claimable_balances: false },
  });
});

app.get("/sep6/deposit", async (req: Request, res: Response) => {
  const account = authed(req, res);
  if (!account) return;
  if (String(req.query.asset_code ?? "") !== cfg.ATRY_CODE) {
    res.status(400).json({ error: `Only ${cfg.ATRY_CODE} deposits are supported.` });
    return;
  }
  const amount = Number(req.query.amount ?? NaN);
  if (!Number.isFinite(amount) || amount < cfg.MIN_DEPOSIT_TRY || amount > cfg.MAX_DEPOSIT_TRY) {
    res.status(400).json({
      error: `amount must be between ${cfg.MIN_DEPOSIT_TRY} and ${cfg.MAX_DEPOSIT_TRY} TRY`,
    });
    return;
  }
  const destination = String(req.query.account ?? account);
  if (!/^G[A-Z2-7]{55}$/.test(destination)) {
    res.status(400).json({ error: "account must be a Stellar public key" });
    return;
  }

  const { out, fee } = quoteDeposit(cfg, amount);
  const id = depositId();
  const ref = reference();
  await store.insertTx({
    id,
    kind: "deposit",
    account: destination,
    status: "pending_user_transfer_start",
    amount_in: amount.toFixed(2),
    amount_out: out,
    amount_fee: fee,
    reference: ref,
    memo: null,
    external_transaction_id: null,
    stellar_transaction_id: null,
    message: "Send the lira to the account below, with the reference in the description.",
  });

  res.json({
    id,
    how: `Send ${amount.toFixed(2)} TRY to ${cfg.BANK_IBAN} (${cfg.BANK_NAME}) with "${ref}" in the description.`,
    instructions: {
      bank_name: { value: cfg.BANK_NAME, description: "Bank holding the anchor account" },
      bank_account_number: {
        value: cfg.BANK_IBAN,
        description: `IBAN to send TRY to (account holder: ${cfg.BANK_ACCOUNT_HOLDER})`,
      },
      external_transfer_memo: {
        value: ref,
        description:
          "Write this reference in the transfer description (açıklama). It routes the money to your account.",
      },
    },
    eta: 10,
    fee_percent: cfg.FEE_BPS / 100,
    ...(cfg.ALLOW_SIMULATED_TRANSFERS
      ? {
          extra_info: {
            message: `Testnet: no real bank exists. Simulate the incoming transfer with POST ${cfg.PUBLIC_URL}/sep6/tx/${id}/simulate-bank-transfer. ${cfg.ATRY_CODE} is then issued to ${destination}.`,
          },
        }
      : {}),
  });
});

app.get("/sep6/withdraw", async (req: Request, res: Response) => {
  const account = authed(req, res);
  if (!account) return;
  if (String(req.query.asset_code ?? "") !== cfg.ATRY_CODE) {
    res.status(400).json({ error: `Only ${cfg.ATRY_CODE} withdrawals are supported.` });
    return;
  }
  const amount = Number(req.query.amount ?? NaN);
  if (!Number.isFinite(amount) || amount <= 0) {
    res.status(400).json({ error: "amount must be a positive number" });
    return;
  }
  const customer = await store.customer(account);
  if (!customer?.bank_account_number) {
    res.status(403).json({
      error: "Register an IBAN with SEP-12 before withdrawing.",
      type: "customer_info_needed",
      fields: ["bank_account_number"],
    });
    return;
  }

  const { out, fee } = quoteWithdraw(cfg, amount);
  const id = withdrawalId();
  await store.insertTx({
    id,
    kind: "withdrawal",
    account,
    status: "pending_user_transfer_start",
    amount_in: amount.toFixed(7),
    amount_out: out,
    amount_fee: fee,
    reference: null,
    memo: memoFor(id),
    external_transaction_id: null,
    stellar_transaction_id: null,
    message: `Send ${cfg.ATRY_CODE} to the issuer with this memo; the lira follows to your IBAN.`,
  });

  res.json({
    id,
    account_id: stellar.issuerAddress,
    memo_type: "text",
    memo: memoFor(id),
    how: `Send ${amount} ${cfg.ATRY_CODE} to ${stellar.issuerAddress} with memo "${memoFor(id)}".`,
    eta: 10,
    fee_percent: cfg.FEE_BPS / 100,
  });
});

const DRIVABLE = new Set(["pending_anchor", "pending_trust", "submitting"]);

app.get("/sep6/transaction", async (req: Request, res: Response) => {
  const account = authed(req, res);
  if (!account) return;
  let tx = await store.tx(String(req.query.id ?? ""));
  if (!tx || tx.account !== account) {
    res.status(404).json({ error: "No such transaction for this account." });
    return;
  }

  // The caller is waiting on this one, so let their poll do the work. Only
  // when there is work: an already-finished transaction answers instantly.
  if (cfg.WORKER_MODE === "request" && DRIVABLE.has(tx.status)) {
    await worker.tickOnce().catch((err) => log.error({ err }, "request-driven tick failed"));
    tx = (await store.tx(tx.id)) ?? tx;
  }
  res.json({ transaction: present(tx) });
});

/**
 * Turn the crank from outside.
 *
 * A backstop for anything nobody is polling for — a user who closed the tab
 * mid-deposit, or a withdrawal whose burn arrived while the site was idle.
 * Safe to call as often as you like: it only ever does work that is due.
 */
app.post("/worker/tick", async (_req: Request, res: Response) => {
  await worker.tickOnce();
  res.json({
    ok: worker.lastError === null,
    completed: worker.completed,
    failed: worker.failed,
    last_error: worker.lastError,
  });
});

app.get("/sep6/transactions", async (req: Request, res: Response) => {
  const account = authed(req, res);
  if (!account) return;
  res.json({ transactions: (await store.listTxs(account)).map(present) });
});

/** A human-readable page, handy when debugging a stuck transfer. */
app.get("/sep6/tx/:id", async (req: Request, res: Response) => {
  const tx = await store.tx(String(req.params.id));
  if (!tx) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json({ transaction: present(tx) });
});

/**
 * Testnet only: stand in for the bank.
 *
 * Kept behind a config flag and named for what it is, because it mints
 * tokens against money nobody sent. In production the bank feed replaces
 * this and nothing else about the flow changes.
 */
app.post("/sep6/tx/:id/simulate-bank-transfer", async (req: Request, res: Response) => {
  if (!cfg.ALLOW_SIMULATED_TRANSFERS) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const id = String(req.params.id);
  const tx = await store.tx(id);
  if (!tx || tx.kind !== "deposit") {
    res.status(404).json({ error: "No such deposit." });
    return;
  }
  // Only from "waiting for the bank", so calling it twice cannot mint twice.
  if (!(await store.claim(id, "pending_user_transfer_start", "pending_anchor"))) {
    res.status(409).json({ error: `This deposit is already ${tx.status}.`, transaction: present(tx) });
    return;
  }
  const updated = await store.update(id, {
    external_transaction_id: `SIM-${tx.reference ?? id}`,
    message: `TRY received; issuing ${cfg.ATRY_CODE} on Stellar.`,
  });
  log.info({ id }, "simulated bank transfer recorded");

  // Where no timer is running, this request is what drives the payout —
  // and it is the right moment for it, because the money just arrived.
  let latest = updated!;
  if (cfg.WORKER_MODE === "request") {
    await worker.tickOnce().catch((err) => log.error({ err, id }, "request-driven tick failed"));
    latest = (await store.tx(id)) ?? latest;
  }
  res.json({ ok: true, transaction: present(latest) });
});

app.use((req: Request, res: Response) => {
  res.status(404).json({ error: "not_found", path: req.path });
});
