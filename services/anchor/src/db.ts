import { Pool, type PoolClient } from "pg";

/**
 * The anchor's ledger.
 *
 * Everything that matters survives a restart, because the thing an anchor
 * must never do is forget that it owes somebody money. A crash between
 * taking the lira and delivering the token has to be recoverable from the
 * ledger alone, so the state machine lives here rather than in memory.
 *
 * Postgres rather than a file, because the process this runs in may be
 * replaced between any two requests. That also means the guarantees cannot
 * come from "there is only one worker" — they have to come from the
 * database, which is why the claim below is a conditional UPDATE and not a
 * lock held in this process.
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
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
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
  next_attempt_at         TIMESTAMPTZ,
  started_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at            TIMESTAMPTZ
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

/** Columns a caller may set through `update`. Anything else is ignored. */
const UPDATABLE = new Set([
  "status",
  "amount_in",
  "amount_out",
  "amount_fee",
  "external_transaction_id",
  "stellar_transaction_id",
  "message",
  "attempts",
  "next_attempt_at",
  "completed_at",
]);

/** Timestamps come back as Date; the rest of the app speaks ISO strings. */
function row<T>(r: Record<string, unknown> | undefined): T | null {
  if (!r) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) out[k] = v instanceof Date ? v.toISOString() : v;
  return out as T;
}

export class Store {
  private readonly pool: Pool;
  private ready: Promise<void> | null = null;

  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      // Managed Postgres is TLS-only and presents a chain Node does not
      // ship a root for; the connection is still encrypted.
      ssl: /localhost|127\.0\.0\.1/.test(connectionString)
        ? false
        : { rejectUnauthorized: false },
      max: 4,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 8_000,
    });
  }

  /** Create the schema once per process, and only when first needed. */
  async init(): Promise<void> {
    this.ready ??= this.pool.query(SCHEMA).then(() => undefined);
    return this.ready;
  }

  private async q<T>(text: string, values: unknown[] = []): Promise<T[]> {
    await this.init();
    const result = await this.pool.query(text, values);
    return result.rows.map((r) => row<T>(r as Record<string, unknown>)!);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  /** For the health check: can we actually reach the ledger? */
  async ping(): Promise<boolean> {
    try {
      await this.q("SELECT 1");
      return true;
    } catch {
      return false;
    }
  }

  // ------------------------------------------------------------ customers

  async upsertCustomer(
    c: Omit<Customer, "created_at" | "updated_at">,
  ): Promise<Customer> {
    await this.q(
      `INSERT INTO customers (account, id, first_name, last_name, email_address,
                              bank_account_number, bank_name, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (account) DO UPDATE SET
         first_name          = COALESCE(EXCLUDED.first_name, customers.first_name),
         last_name           = COALESCE(EXCLUDED.last_name, customers.last_name),
         email_address       = COALESCE(EXCLUDED.email_address, customers.email_address),
         bank_account_number = COALESCE(EXCLUDED.bank_account_number, customers.bank_account_number),
         bank_name           = COALESCE(EXCLUDED.bank_name, customers.bank_name),
         status              = EXCLUDED.status,
         updated_at          = now()`,
      [
        c.account,
        c.id,
        c.first_name,
        c.last_name,
        c.email_address,
        c.bank_account_number,
        c.bank_name,
        c.status,
      ],
    );
    return (await this.customer(c.account))!;
  }

  async customer(account: string): Promise<Customer | null> {
    const rows = await this.q<Customer>("SELECT * FROM customers WHERE account = $1", [account]);
    return rows[0] ?? null;
  }

  // --------------------------------------------------------- transactions

  async insertTx(
    tx: Omit<
      AnchorTx,
      "attempts" | "next_attempt_at" | "started_at" | "updated_at" | "completed_at"
    >,
  ): Promise<AnchorTx> {
    const rows = await this.q<AnchorTx>(
      `INSERT INTO transactions (id, kind, account, status, amount_in, amount_out, amount_fee,
                                 reference, memo, external_transaction_id, stellar_transaction_id,
                                 message, attempts)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,0)
       RETURNING *`,
      [
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
      ],
    );
    return rows[0]!;
  }

  async tx(id: string): Promise<AnchorTx | null> {
    const rows = await this.q<AnchorTx>("SELECT * FROM transactions WHERE id = $1", [id]);
    return rows[0] ?? null;
  }

  async txByReference(reference: string): Promise<AnchorTx | null> {
    const rows = await this.q<AnchorTx>("SELECT * FROM transactions WHERE reference = $1", [
      reference,
    ]);
    return rows[0] ?? null;
  }

  async txByMemo(memo: string): Promise<AnchorTx | null> {
    const rows = await this.q<AnchorTx>(
      "SELECT * FROM transactions WHERE memo = $1 ORDER BY started_at DESC LIMIT 1",
      [memo],
    );
    return rows[0] ?? null;
  }

  async listTxs(account: string, limit = 50): Promise<AnchorTx[]> {
    return this.q<AnchorTx>(
      "SELECT * FROM transactions WHERE account = $1 ORDER BY started_at DESC LIMIT $2",
      [account, limit],
    );
  }

  /**
   * Move a transaction from one status to another, and only from that one.
   *
   * This is the whole of the concurrency story, and it is why the anchor is
   * safe to run in a place where several copies of it may be alive at once:
   * a worker claims a job by winning this UPDATE. Everyone else — a second
   * instance, a retry, a duplicate request — finds zero rows changed and
   * does nothing, so a deposit cannot be paid twice.
   */
  async claim(id: string, from: TxStatus, to: TxStatus): Promise<boolean> {
    await this.init();
    const result = await this.pool.query(
      "UPDATE transactions SET status = $1, updated_at = now() WHERE id = $2 AND status = $3",
      [to, id, from],
    );
    return result.rowCount === 1;
  }

  async update(id: string, fields: Partial<Omit<AnchorTx, "id">>): Promise<AnchorTx | null> {
    const entries = Object.entries(fields).filter(([k]) => UPDATABLE.has(k));
    if (entries.length === 0) return this.tx(id);
    const set = entries.map(([k], i) => `${k} = $${i + 2}`).join(", ");
    const rows = await this.q<AnchorTx>(
      `UPDATE transactions SET ${set}, updated_at = now() WHERE id = $1 RETURNING *`,
      [id, ...entries.map(([, v]) => v)],
    );
    return rows[0] ?? null;
  }

  /** Deposits whose lira has arrived and whose tokens are not out yet. */
  async duePayouts(now = new Date()): Promise<AnchorTx[]> {
    return this.q<AnchorTx>(
      `SELECT * FROM transactions
        WHERE kind = 'deposit'
          AND status IN ('pending_anchor', 'pending_trust')
          AND (next_attempt_at IS NULL OR next_attempt_at <= $1)
        ORDER BY started_at ASC
        LIMIT 20`,
      [now.toISOString()],
    );
  }

  /**
   * Anything left mid-flight by a crash.
   *
   * `submitting` means a process died with a payment possibly already on the
   * network, so recovery has to look at the chain before retrying rather
   * than simply paying again. A `submitting` row older than a minute is
   * certainly abandoned: nothing legitimate stays there that long.
   */
  async strandedPayouts(olderThanMs = 60_000): Promise<AnchorTx[]> {
    return this.q<AnchorTx>(
      `SELECT * FROM transactions
        WHERE status = 'submitting' AND updated_at < $1
        ORDER BY started_at ASC`,
      [new Date(Date.now() - olderThanMs).toISOString()],
    );
  }

  // -------------------------------------------------------------- cursors

  async cursor(name: string): Promise<string | null> {
    const rows = await this.q<{ value: string }>("SELECT value FROM cursors WHERE name = $1", [
      name,
    ]);
    return rows[0]?.value ?? null;
  }

  async setCursor(name: string, value: string): Promise<void> {
    await this.q(
      `INSERT INTO cursors (name, value) VALUES ($1, $2)
       ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value`,
      [name, value],
    );
  }

  /** Escape hatch for tests that need a raw connection. */
  async withClient<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    await this.init();
    const client = await this.pool.connect();
    try {
      return await fn(client);
    } finally {
      client.release();
    }
  }
}
