import {
  Asset,
  BASE_FEE,
  Horizon,
  Keypair,
  Memo,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";

import type { Config } from "./config.js";

/**
 * Everything this anchor does on the chain.
 *
 * aTRY is a claim on lira the anchor is holding, so issuing and burning are
 * both just payments: the issuer paying a user brings tokens into
 * existence, and a user paying the issuer destroys them. There is no
 * treasury to drain and no supply to reconcile — the amount of aTRY in the
 * world is exactly the lira this anchor has taken in and not paid back.
 */
export class StellarOps {
  readonly issuer: Keypair;
  readonly asset: Asset;
  readonly horizon: Horizon.Server;

  constructor(private readonly cfg: Config) {
    this.issuer = Keypair.fromSecret(cfg.ATRY_ISSUER_SECRET);
    this.asset = new Asset(cfg.ATRY_CODE, this.issuer.publicKey());
    this.horizon = new Horizon.Server(cfg.HORIZON_URL);
  }

  get issuerAddress(): string {
    return this.issuer.publicKey();
  }

  /** Does this account have somewhere to put aTRY? */
  async hasTrustline(account: string): Promise<boolean> {
    try {
      const loaded = await this.horizon.loadAccount(account);
      return loaded.balances.some(
        (b) =>
          "asset_code" in b &&
          b.asset_code === this.cfg.ATRY_CODE &&
          b.asset_issuer === this.issuerAddress,
      );
    } catch (err) {
      if ((err as { response?: { status?: number } }).response?.status === 404) return false;
      throw err;
    }
  }

  /**
   * Has this payout already gone out?
   *
   * Asked after a crash, before retrying. Every payout carries the
   * transaction's own id as a text memo, so the chain itself is the record
   * of what was delivered — which is the only way to be sure we are not
   * about to pay somebody twice.
   */
  async alreadyPaid(txId: string, destination: string): Promise<string | null> {
    const memo = memoFor(txId);
    let page = await this.horizon
      .payments()
      .forAccount(this.issuerAddress)
      .order("desc")
      .limit(200)
      .call();

    for (let depth = 0; depth < 5; depth++) {
      for (const record of page.records) {
        if (record.type !== "payment") continue;
        if (record.to !== destination || record.from !== this.issuerAddress) continue;
        if (record.asset_code !== this.cfg.ATRY_CODE) continue;
        const tx = await record.transaction();
        if (tx.memo_type === "text" && tx.memo === memo) return tx.id;
      }
      if (page.records.length < 200) break;
      page = await page.next();
    }
    return null;
  }

  /** Pay aTRY to a user: this is what minting looks like. */
  async issueTo(account: string, amount: string, txId: string): Promise<string> {
    const source = await this.horizon.loadAccount(this.issuerAddress);
    const tx = new TransactionBuilder(source, {
      fee: String(Number(BASE_FEE) * 100),
      networkPassphrase: this.cfg.NETWORK_PASSPHRASE,
    })
      .addOperation(Operation.payment({ destination: account, asset: this.asset, amount }))
      .addMemo(Memo.text(memoFor(txId)))
      .setTimeout(60)
      .build();
    tx.sign(this.issuer);
    const submitted = await this.horizon.submitTransaction(tx);
    return submitted.hash;
  }

  /** Incoming aTRY payments to the issuer, which are withdrawals being burned. */
  async incomingBurns(cursor: string | null): Promise<
    Array<{ pagingToken: string; from: string; amount: string; memo: string | null; txId: string }>
  > {
    const builder = this.horizon.payments().forAccount(this.issuerAddress).order("asc").limit(100);
    if (cursor) builder.cursor(cursor);
    const page = await builder.call();

    const out: Array<{
      pagingToken: string;
      from: string;
      amount: string;
      memo: string | null;
      txId: string;
    }> = [];
    for (const record of page.records) {
      if (record.type !== "payment") {
        // Still advance past it, or the cursor sticks here forever.
        out.push({
          pagingToken: record.paging_token,
          from: "",
          amount: "0",
          memo: null,
          txId: "",
        });
        continue;
      }
      if (record.to !== this.issuerAddress || record.asset_code !== this.cfg.ATRY_CODE) {
        out.push({
          pagingToken: record.paging_token,
          from: "",
          amount: "0",
          memo: null,
          txId: "",
        });
        continue;
      }
      const tx = await record.transaction();
      out.push({
        pagingToken: record.paging_token,
        from: record.from,
        amount: record.amount,
        memo: tx.memo_type === "text" ? (tx.memo ?? null) : null,
        txId: tx.id,
      });
    }
    return out;
  }
}

/** Memos are 28 bytes; our ids are built to fit. */
export function memoFor(txId: string): string {
  return txId.slice(0, 28);
}

/**
 * Is this error worth trying again?
 *
 * A trustline that is not there yet, or a sequence number that raced, will
 * succeed later. A malformed transaction never will, and retrying it just
 * burns attempts and hides the real problem.
 */
export function isRetryable(err: unknown): boolean {
  const codes = (err as {
    response?: { data?: { extras?: { result_codes?: { transaction?: string; operations?: string[] } } } };
  }).response?.data?.extras?.result_codes;
  if (!codes) return true; // a network or timeout error
  if (codes.transaction === "tx_bad_seq" || codes.transaction === "tx_too_late") return true;
  if (codes.operations?.some((c) => c === "op_no_trust" || c === "op_no_destination")) return true;
  return false;
}

/** The one failure that is the user's to fix, not ours to retry around. */
export function isMissingTrustline(err: unknown): boolean {
  const codes = (err as {
    response?: { data?: { extras?: { result_codes?: { operations?: string[] } } } };
  }).response?.data?.extras?.result_codes;
  return Boolean(codes?.operations?.some((c) => c === "op_no_trust"));
}
