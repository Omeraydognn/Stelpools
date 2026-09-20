import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * The anchor's ledger.
 *
 * Everything that matters survives a restart, because the thing an anchor
 * must never do is forget that it owes somebody money. A crash between
 * taking the lira and delivering the token has to be recoverable from
 * disk alone, so the state machine lives here rather than in memory.
 *
 * SQLite is used through Node's built-in binding: one file, real
 * transactions, no service to run beside this one.
 */

export type TxKind = "deposit" | "withdrawal";

/** SEP-6 statuses, plus `submitting` which is ours. */
export type TxStatus =
  | "incomplete"
  | "pending_user_transfer_start"
  | "pending_anchor"
  | "submitting"
  | "pending_trust"
  | "completed"
  | "error";

export interface AnchorTx {
  id: string;
  kind: TxKind;
  account: string;
  status: TxStatus;
  amount_in: string | null;
  amount_out: string | null;
  amount_fee: string | null;
  /** Deposits: the code the bank description must carry. */
  reference: string | null;
  /** Withdrawals: the memo the user's payment must carry. */
  memo: string | null;
  external_transaction_id: string | null;
  stellar_transaction_id: string | null;
  message: string | null;
  attempts: number;
  next_attempt_at: string | null;
  started_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface Customer {
  account: string;
  id: string;
  first_name: string | null;
  last_name: string | null;
  email_address: string | null;
  bank_account_number: string | null;
  bank_name: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS customers (
  account             TEXT PRIMARY KEY,
  id                  TEXT NOT NULL UNIQUE,
  first_name          TEXT,
  last_name           TEXT,
  email_address       TEXT,
  bank_account_number TEXT,
  bank_name           TEXT,
  status              TEXT NOT NULL,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
  id                      TEXT PRIMARY KEY,
  kind                    TEXT NOT NULL,
  account                 TEXT NOT NULL,
  status                  TEXT NOT NULL,
  amount_in               TEXT,
  amount_out              TEXT,
  amount_fee              TEXT,
  reference               TEXT UNIQUE,
  memo                    TEXT,
  external_transaction_id TEXT,
  stellar_transaction_id  TEXT,
  message                 TEXT,
  attempts                INTEGER NOT NULL DEFAULT 0,
  next_attempt_at         TEXT,
  started_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL,
  completed_at            TEXT
);

CREATE INDEX IF NOT EXISTS tx_by_account ON transactions(account, started_at DESC);
CREATE INDEX IF NOT EXISTS tx_by_status  ON transactions(status);
CREATE INDEX IF NOT EXISTS tx_by_memo    ON transactions(memo);

/* Horizon paging cursors, so a restart resumes where the watcher stopped
   instead of replaying the whole history or missing the gap. */
CREATE TABLE IF NOT EXISTS cursors (
  name   TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);
`;

export class Store {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    // WAL survives a hard kill mid-write; FULL sync means a completed
    // payout is on disk before we admit to it.
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA synchronous = FULL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  // ------------------------------------------------------------ customers

  upsertCustomer(c: Omit<Customer, "created_at" | "updated_at">): Customer {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO customers (account, id, first_name, last_name, email_address,
                                bank_account_number, bank_name, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(account) DO UPDATE SET
           first_name          = COALESCE(excluded.first_name, customers.first_name),
           last_name           = COALESCE(excluded.last_name, customers.last_name),
           email_address       = COALESCE(excluded.email_address, customers.email_address),
           bank_account_number = COALESCE(excluded.bank_account_number, customers.bank_account_number),
           bank_name           = COALESCE(excluded.bank_name, customers.bank_name),
           status              = excluded.status,
           updated_at          = excluded.updated_at`,
      )
      .run(
        c.account,
        c.id,
        c.first_name,
        c.last_name,
        c.email_address,
        c.bank_account_number,
        c.bank_name,
        c.status,
        now,
        now,
      );
    return this.customer(c.account)!;
  }

  customer(account: string): Customer | null {
    return (
      (this.db.prepare("SELECT * FROM customers WHERE account = ?").get(account) as
        | Customer
        | undefined) ?? null
    );
  }

  // --------------------------------------------------------- transactions

  insertTx(
    tx: Omit<AnchorTx, "attempts" | "next_attempt_at" | "started_at" | "updated_at" | "completed_at">,
  ): AnchorTx {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO transactions (id, kind, account, status, amount_in, amount_out, amount_fee,
                                   reference, memo, external_transaction_id, stellar_transaction_id,
                                   message, attempts, next_attempt_at, started_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)`,
      )
      .run(
        tx.id,
        tx.kind,
        tx.account,
        tx.status,
        tx.amount_in,
        tx.amount_out,
        tx.amount_fee,
        tx.reference,
        tx.memo,
        tx.external_transaction_id,
        tx.stellar_transaction_id,
        tx.message,
        now,
        now,
      );
    return this.tx(tx.id)!;
  }

  tx(id: string): AnchorTx | null {
    return (
      (this.db.prepare("SELECT * FROM transactions WHERE id = ?").get(id) as
        | AnchorTx
        | undefined) ?? null
    );
  }

  txByReference(reference: string): AnchorTx | null {
    return (
      (this.db.prepare("SELECT * FROM transactions WHERE reference = ?").get(reference) as
        | AnchorTx
        | undefined) ?? null
    );
  }

  txByMemo(memo: string): AnchorTx | null {
    return (
      (this.db
        .prepare("SELECT * FROM transactions WHERE memo = ? ORDER BY started_at DESC")
        .get(memo) as AnchorTx | undefined) ?? null
    );
  }

  listTxs(account: string, limit = 50): AnchorTx[] {
    return this.db
      .prepare("SELECT * FROM transactions WHERE account = ? ORDER BY started_at DESC LIMIT ?")
      .all(account, limit) as unknown as AnchorTx[];
  }

  /**
   * Move a transaction from one status to another, and only from that one.
   *
   * This is the whole of the concurrency story: the worker claims a job by
   * winning this UPDATE. A second worker, or a retry of the same one, finds
   * zero rows changed and does nothing — so a deposit cannot be paid twice
   * even if the process is restarted mid-flight.
   */
  claim(id: string, from: TxStatus, to: TxStatus): boolean {
    const result = this.db
      .prepare(
        "UPDATE transactions SET status = ?, updated_at = ? WHERE id = ? AND status = ?",
      )
      .run(to, new Date().toISOString(), id, from);
    return Number(result.changes) === 1;
  }

  update(id: string, fields: Partial<Omit<AnchorTx, "id">>): AnchorTx | null {
    const keys = Object.keys(fields);
    if (keys.length === 0) return this.tx(id);
    const set = keys.map((k) => `${k} = ?`).join(", ");
    const values = keys.map((k) => (fields as Record<string, unknown>)[k] as never);
    this.db
      .prepare(`UPDATE transactions SET ${set}, updated_at = ? WHERE id = ?`)
      .run(...values, new Date().toISOString(), id);
    return this.tx(id);
  }

  /** Deposits whose lira has arrived and whose tokens are not out yet. */
  duePayouts(now = new Date()): AnchorTx[] {
    return this.db
      .prepare(
        `SELECT * FROM transactions
          WHERE kind = 'deposit'
            AND status IN ('pending_anchor', 'pending_trust')
            AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
          ORDER BY started_at ASC
          LIMIT 20`,
      )
      .all(now.toISOString()) as unknown as AnchorTx[];
  }

  /**
   * Anything left mid-flight by a crash.
   *
   * `submitting` means the process died with a payment possibly already on
   * the network, so recovery has to look at the chain before retrying
   * rather than simply paying again.
   */
  strandedPayouts(): AnchorTx[] {
    return this.db
      .prepare("SELECT * FROM transactions WHERE status = 'submitting' ORDER BY started_at ASC")
      .all() as unknown as AnchorTx[];
  }

  // -------------------------------------------------------------- cursors

  cursor(name: string): string | null {
    const row = this.db.prepare("SELECT value FROM cursors WHERE name = ?").get(name) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  }

  setCursor(name: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO cursors (name, value) VALUES (?, ?)
         ON CONFLICT(name) DO UPDATE SET value = excluded.value`,
      )
      .run(name, value);
  }
}
