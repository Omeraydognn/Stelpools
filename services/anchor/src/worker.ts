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
 *  - every job is a row on disk, never a promise held in memory;
 *  - a job is claimed by an atomic status change, so a restart or a second
 *    worker cannot pay the same deposit twice;
 *  - a crash mid-submit is resolved by asking the chain what happened
 *    rather than guessing;
 *  - failures back off and are counted, and a job that exhausts its
 *    attempts stops silently failing and starts saying so;
 *  - the loop reports its own liveness, so "the worker is dead" is
 *    something `/health` can tell you instead of something you find out
 *    from an angry user.
 */
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

  /** True when the loop has run recently enough to be believed. */
  healthy(now = Date.now()): boolean {
    if (!this.lastTickAt) return false;
    return now - this.lastTickAt.getTime() < this.cfg.WORKER_INTERVAL_MS * 10;
  }

  /**
   * A process that died between submitting and recording.
   *
   * The payment may or may not be on the ledger, and the only honest way to
   * find out is to look. Each payout carries its transaction id as a memo
   * precisely so this question has an answer.
   */
  private async recoverStranded(): Promise<void> {
    const stranded = this.store.strandedPayouts();
    if (stranded.length === 0) return;
    this.log.warn({ count: stranded.length }, "resolving payouts left mid-submit");

    for (const tx of stranded) {
      try {
        const hash = await this.stellar.alreadyPaid(tx.id, tx.account);
        if (hash) {
          this.store.update(tx.id, {
            status: "completed",
            stellar_transaction_id: hash,
            completed_at: new Date().toISOString(),
            message: null,
          });
          this.log.info({ id: tx.id, hash }, "recovered: the payment had landed");
        } else {
          this.store.update(tx.id, { status: "pending_anchor" });
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
      for (const tx of this.store.duePayouts()) {
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
    if (!this.store.claim(tx.id, tx.status, "submitting")) return;

    const amount = tx.amount_out;
    if (!amount) {
      this.store.update(tx.id, { status: "error", message: "No amount to pay out." });
      this.failed += 1;
      return;
    }

    try {
      // A payment to an account with no trustline fails; asking first turns
      // that into a status the user can act on rather than a wasted attempt.
      if (!(await this.stellar.hasTrustline(tx.account))) {
        this.store.update(tx.id, {
          status: "pending_trust",
          message: `Add a ${this.cfg.ATRY_CODE} trustline to receive this payment.`,
          next_attempt_at: new Date(Date.now() + 10_000).toISOString(),
        });
        return;
      }

      const hash = await this.stellar.issueTo(tx.account, amount, tx.id);
      this.store.update(tx.id, {
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
      this.store.update(tx.id, {
        status: "pending_trust",
        attempts,
        message: `Add a ${this.cfg.ATRY_CODE} trustline to receive this payment.`,
        next_attempt_at: new Date(Date.now() + 10_000).toISOString(),
      });
      return;
    }

    if (!isRetryable(err) || attempts >= this.cfg.MAX_PAYOUT_ATTEMPTS) {
      this.store.update(tx.id, {
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
    this.store.update(tx.id, {
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
    const cursor = this.store.cursor("burns");
    const payments = await this.stellar.incomingBurns(cursor);

    for (const payment of payments) {
      // Advance the cursor first: a payment we have looked at is one we
      // never look at again, even if handling it throws.
      this.store.setCursor("burns", payment.pagingToken);
      if (!payment.from || !payment.memo) continue;

      const tx = this.store.txByMemo(payment.memo);
      if (!tx || tx.kind !== "withdrawal") {
        this.log.warn({ memo: payment.memo, from: payment.from }, "aTRY arrived with no matching withdrawal");
        continue;
      }
      if (tx.account !== payment.from) {
        this.log.warn({ id: tx.id, from: payment.from }, "withdrawal paid from a different account");
        continue;
      }
      if (!this.store.claim(tx.id, "pending_user_transfer_start", "pending_anchor")) continue;

      // The lira leg is the bank's, and on testnet there is no bank. The
      // tokens are genuinely burned either way: they are back with their
      // issuer and out of circulation.
      this.store.update(tx.id, {
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
