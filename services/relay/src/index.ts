import express, { type NextFunction, type Request, type Response } from "express";
import pino from "pino";
import { z } from "zod";

import { accountForToken, readDeposit } from "./anchor.js";
import { loadConfig } from "./config.js";
import { assess } from "./eligibility.js";
import { VaultCallError, VaultClient } from "./vault.js";

const cfg = loadConfig();
const log = pino({
  level: cfg.LOG_LEVEL,
  redact: { paths: ["*.jwt", "req.headers.authorization"], censor: "[redacted]" },
});
const vault = new VaultClient(cfg);

const advanceRequest = z.object({
  /** SEP-10 token for the account asking. The relay spends it once. */
  jwt: z.string().min(20),
  /** The anchor's SEP-6 deposit id. */
  transaction_id: z.string().min(4),
});

const app = express();
app.use(express.json({ limit: "64kb" }));

const allowed = new Set(cfg.CORS_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean));
app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.header("origin");
  if (origin && (allowed.has("*") || allowed.has(origin))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  }
  if (req.method === "OPTIONS") {
    res.sendStatus(origin && allowed.has(origin) ? 204 : 403);
    return;
  }
  next();
});

app.get("/health", async (_req: Request, res: Response) => {
  try {
    const [liquid, advanced] = await Promise.all([vault.liquidAssets(), vault.totalAdvanced()]);
    res.json({
      ok: true,
      service: "vault-relay",
      relay: vault.address,
      vault: cfg.VAULT_CONTRACT_ID,
      liquid_usdc: (Number(liquid) / 1e7).toFixed(7),
      advanced_usdc: (Number(advanced) / 1e7).toFixed(7),
      max_advance_usdc: cfg.MAX_ADVANCE_USDC,
    });
  } catch (err) {
    res.status(503).json({ ok: false, message: (err as Error).message });
  }
});

/**
 * Front a deposit the anchor has accepted but not yet delivered.
 *
 * The relay is a trusted component and this is the only power it has: it can
 * tell the vault to pay someone, up to limits the vault's admin set, and it
 * can never move the pool's money anywhere else. The user repays from their
 * own wallet once the anchor's USDC arrives.
 */
app.post("/advance", async (req: Request, res: Response) => {
  const parsed = advanceRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_payload", issues: parsed.error.issues });
    return;
  }
  const { jwt, transaction_id } = parsed.data;

  const account = await accountForToken(cfg, jwt);
  if (!account) {
    res.status(401).json({ error: "bad_token", message: "SEP-10 token okunamadı." });
    return;
  }

  try {
    const txn = await readDeposit(cfg, jwt, transaction_id);
    const owed = await vault.advanceOf(account);
    const verdict = assess(txn, account, cfg.MAX_ADVANCE_USDC, owed);
    if (!verdict.ok || !verdict.amountStroops) {
      log.info({ account, transaction_id, reason: verdict.reason }, "advance refused");
      res.status(409).json({ error: "not_eligible", message: verdict.reason });
      return;
    }

    const { hash, value } = await vault.openAdvance(account, verdict.amountStroops);
    log.warn(
      { account, transaction_id, amount: verdict.amountStroops.toString(), hash },
      "advance opened",
    );
    res.json({
      account,
      paid_out_usdc: (Number(value ?? verdict.amountStroops) / 1e7).toFixed(7),
      owed_usdc: (Number(await vault.advanceOf(account)) / 1e7).toFixed(7),
      tx_hash: hash,
    });
  } catch (err) {
    const status = (err as { status?: number }).status ?? (err instanceof VaultCallError ? 409 : 502);
    log.error({ err, account }, "advance failed");
    res.status(status).json({ error: "advance_failed", message: (err as Error).message });
  }
});

app.get("/advance/:account", async (req: Request, res: Response) => {
  const account = String(req.params.account);
  if (!/^G[A-Z2-7]{55}$/.test(account)) {
    res.status(400).json({ error: "invalid_account" });
    return;
  }
  try {
    const owed = await vault.advanceOf(account);
    res.json({ account, owed_usdc: (Number(owed) / 1e7).toFixed(7), owed_stroops: owed.toString() });
  } catch (err) {
    res.status(502).json({ error: "read_failed", message: (err as Error).message });
  }
});

app.use((req: Request, res: Response) => {
  res.status(404).json({ error: "not_found", path: req.path });
});

app.listen(cfg.PORT, () => {
  log.info({ port: cfg.PORT, relay: vault.address, vault: cfg.VAULT_CONTRACT_ID }, "relay listening");
});
