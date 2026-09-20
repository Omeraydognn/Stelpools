import type { Logger } from "pino";

import type { Config } from "./config.js";
import type { AnchorTx, Store } from "./db.js";
import { isMissingTrustline, isRetryable, StellarOps } from "./stellar.js";

/**
 * The part that actually delivers.
 *
 * This exists in the shape it does because of a failure we watched happen
 * in another anchor: its HTTP surface stayed perfectly healthy — accepting
 * deposits, reporting `ok`, moving transactions to `pending_anchor` — while
 * the thing that submits payments had quietly died. Money went in and
 * nothing came out, for hours, with a funded treasury.
 *
 * So this worker is built to be the opposite:
 *
 *  - every job is a row in the ledger, never a promise held in memory;
 *  - a job is claimed by an atomic status change, so a restart, a retry or a
 *    second copy of this process cannot pay the same deposit twice;
 *  - a crash mid-submit is resolved by asking the chain what happened
 *    rather than guessing;
 *  - failures back off and are counted, and a job that exhausts its
 *    attempts stops silently failing and starts saying so;
 *  - the loop reports its own liveness, so "the worker is dead" is
 *    something `/health` can tell you instead of something you find out
 *    from an angry user.
 *
 * It runs in one of two modes. On a host that keeps a process alive, a timer
 * drives it. On one that does not — a function that exists only for the
 * length of a request — the work is driven by the requests themselves:
 * reporting a transfer and polling a transaction both turn the crank. That
 * is not a downgrade for an on-ramp, where somebody is always waiting and
 * polling anyway, and none of the guarantees above depend on which mode is
 * in use. They come from the ledger, not from this object.
 */
/** Statuses where a tick has work it could finish right now. */
const DRIVABLE = new Set(["pending_anchor", "pending_trust", "submitting"]);

/**
 * Should a poll for this transaction turn the crank?
 *
 * Only in request mode, and only when a tick could actually finish something.
 * A *deposit* in `pending_user_transfer_start` is waiting on a bank and there
 * is nothing due, so it is deliberately excluded; the transfer report drives
 * that moment instead.
 *
 * A *withdrawal* in the same status is the opposite case, and it is the one
 * that bit us. What it waits for is an aTRY payment that may already be on
 * the ledger, and `collectBurns` is the only thing that will ever notice it.
 * In request mode nothing else ticks, so without this a withdrawal whose burn
 * has landed stays "waiting for your money" forever. That happened in
 * production, with the payment sitting on the ledger the whole time.
 */
export function shouldDrive(
  tx: { kind: string; status: string },
  mode: "timer" | "request",
): boolean {
  if (mode !== "request") return false;
  if (DRIVABLE.has(tx.status)) return true;
  return tx.kind === "withdrawal" && tx.status === "pending_user_transfer_start";
}

export class PayoutWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;

  /** When the loop last finished a pass. Reported by /health. */
  lastTickAt: Date | null = null;
  lastError: string | null = null;
  completed = 0;
  failed = 0;

  constructor(
    private readonly cfg: Config,
    private readonly store: Store,
    private readonly stellar: StellarOps,
    private readonly log: Logger,
  ) {}

  /** Start the timer. Only for hosts that keep a process running. */
  async start(): Promise<void> {
    await this.recoverStranded();
    const tick = () => {
      void this.tick().finally(() => {
        if (!this.stopped) this.timer = setTimeout(tick, this.cfg.WORKER_INTERVAL_MS);
      });
    };
    tick();
    this.log.info({ issuer: this.stellar.issuerAddress }, "payout worker started");
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  /**
   * Can this anchor be believed right now?
   *
   * With a timer, the answer is whether it has run recently — the whole
   * point being that a dead loop must not report itself as fine. Driven by
   * requests there is no loop to watch, so the question becomes whether the
   * last turn of the crank failed.
   */
  healthy(now = Date.now()): boolean {
    if (this.cfg.WORKER_MODE === "request") return this.lastError === null;
    if (!this.lastTickAt) return false;
    return now - this.lastTickAt.getTime() < this.cfg.WORKER_INTERVAL_MS * 10;
  }

  /**
   * Turn the crank once, from a request.
   *
   * Safe to call concurrently: overlapping calls return immediately rather
   * than queueing, and anything they skip is still due on the next one.
   * Stranded payouts are swept here too, because in request mode there is
   * no startup to sweep them at.
   */
  async tickOnce(): Promise<void> {
    if (!this.sweptOnce) {
      this.sweptOnce = true;
      await this.recoverStranded().catch((err) =>
        this.log.error({ err }, "stranded sweep failed"),
      );
    }
    await this.tick();
  }

  private sweptOnce = false;

  /**
   * A process that died between submitting and recording.
   *
   * The payment may or may not be on the ledger, and the only honest way to
   * find out is to look. Each payout carries its transaction id as a memo
   * precisely so this question has an answer.
   */
  private async recoverStranded(): Promise<void> {
    const stranded = await this.store.strandedPayouts();
    if (stranded.length === 0) return;
    this.log.warn({ count: stranded.length }, "resolving payouts left mid-submit");

    for (const tx of stranded) {
      try {
        const hash = await this.stellar.alreadyPaid(tx.id, tx.account);
        if (hash) {
          await this.store.update(tx.id, {
            status: "completed",
            stellar_transaction_id: hash,
            completed_at: new Date().toISOString(),
            message: null,
          });
          this.log.info({ id: tx.id, hash }, "recovered: the payment had landed");
        } else {
          await this.store.update(tx.id, { status: "pending_anchor" });
          this.log.info({ id: tx.id }, "recovered: the payment never landed, will retry");
        }
      } catch (err) {
        // Leave it as `submitting`: unresolved is safer than assumed.
        this.log.error({ err, id: tx.id }, "could not resolve a stranded payout");
      }
    }
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (const tx of await this.store.duePayouts()) {
        await this.payOut(tx);
      }
      await this.collectBurns();
      this.lastTickAt = new Date();
      this.lastError = null;
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      this.log.error({ err }, "payout worker tick failed");
    } finally {
      this.running = false;
    }
  }

  private async payOut(tx: AnchorTx): Promise<void> {
    // Whoever wins this transition owns the job. Everyone else moves on.
    if (!(await this.store.claim(tx.id, tx.status, "submitting"))) return;

    const amount = tx.amount_out;
    if (!amount) {
      await this.store.update(tx.id, { status: "error", message: "No amount to pay out." });
      this.failed += 1;
      return;
    }

    try {
      // A payment to an account with no trustline fails; asking first turns
      // that into a status the user can act on rather than a wasted attempt.
      if (!(await this.stellar.hasTrustline(tx.account))) {
        await this.store.update(tx.id, {
          status: "pending_trust",
          message: `Add a ${this.cfg.ATRY_CODE} trustline to receive this payment.`,
          next_attempt_at: new Date(Date.now() + 10_000).toISOString(),
        });
        return;
      }

      const hash = await this.stellar.issueTo(tx.account, amount, tx.id);
      await this.store.update(tx.id, {
        status: "completed",
        stellar_transaction_id: hash,
        completed_at: new Date().toISOString(),
        message: null,
      });
      this.completed += 1;
      this.log.info({ id: tx.id, account: tx.account, amount, hash }, "deposit delivered");
    } catch (err) {
      await this.handlePayoutFailure(tx, err);
    }
  }

  private async handlePayoutFailure(tx: AnchorTx, err: unknown): Promise<void> {
    const attempts = tx.attempts + 1;
    const message = err instanceof Error ? err.message : String(err);

    if (isMissingTrustline(err)) {
      await this.store.update(tx.id, {
        status: "pending_trust",
        attempts,
        message: `Add a ${this.cfg.ATRY_CODE} trustline to receive this payment.`,
        next_attempt_at: new Date(Date.now() + 10_000).toISOString(),
      });
      return;
    }

    if (!isRetryable(err) || attempts >= this.cfg.MAX_PAYOUT_ATTEMPTS) {
      await this.store.update(tx.id, {
        status: "error",
        attempts,
        message: `Payment failed after ${attempts} attempts: ${message}`,
      });
      this.failed += 1;
      this.log.error({ err, id: tx.id, attempts }, "deposit payout given up on");
      return;
    }

    // Exponential backoff, capped: 2s, 4s, 8s … 2 minutes.
    const delay = Math.min(2_000 * 2 ** (attempts - 1), 120_000);
    await this.store.update(tx.id, {
      status: "pending_anchor",
      attempts,
      message: null,
      next_attempt_at: new Date(Date.now() + delay).toISOString(),
    });
    this.log.warn({ err, id: tx.id, attempts, delay }, "deposit payout will be retried");
  }

  /**
   * Withdrawals: aTRY coming back to the issuer, which burns it.
   *
   * Matched by the memo the withdrawal handed out. A payment with no memo,
   * or one we do not recognise, is left alone and logged — it is somebody's
   * money and guessing whose would be worse than saying we do not know.
   */
  private async collectBurns(): Promise<void> {
    const cursor = await this.store.cursor("burns");
    const payments = await this.stellar.incomingBurns(cursor);

    for (const payment of payments) {
      // Advance the cursor first: a payment we have looked at is one we
      // never look at again, even if handling it throws.
      await this.store.setCursor("burns", payment.pagingToken);
      if (!payment.from || !payment.memo) continue;

      const tx = await this.store.txByMemo(payment.memo);
      if (!tx || tx.kind !== "withdrawal") {
        this.log.warn({ memo: payment.memo, from: payment.from }, "aTRY arrived with no matching withdrawal");
        continue;
      }
      if (tx.account !== payment.from) {
        this.log.warn({ id: tx.id, from: payment.from }, "withdrawal paid from a different account");
        continue;
      }
      if (!(await this.store.claim(tx.id, "pending_user_transfer_start", "pending_anchor"))) continue;

      // The lira leg is the bank's, and on testnet there is no bank. The
      // tokens are genuinely burned either way: they are back with their
      // issuer and out of circulation.
      await this.store.update(tx.id, {
        status: "completed",
        amount_in: payment.amount,
        stellar_transaction_id: payment.txId,
        completed_at: new Date().toISOString(),
        message: "TRY sent to your registered IBAN.",
      });
      this.completed += 1;
      this.log.info({ id: tx.id, amount: payment.amount }, "withdrawal burned and settled");
    }
  }
}
