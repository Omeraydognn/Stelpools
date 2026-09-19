import type { Config } from "./config.js";

export interface Sep6Transaction {
  id: string;
  kind?: string;
  status: string;
  amount_in?: string;
  amount_out?: string;
  to?: string;
  message?: string;
}

/**
 * The anchor's own record of a deposit, read with the user's SEP-10 token.
 *
 * This is the only evidence the relay acts on. It is the anchor saying "I
 * have accepted this person's lira and I owe them USDC" — which is exactly
 * the claim the vault is fronting against.
 */
export async function readDeposit(
  cfg: Config,
  jwt: string,
  id: string,
): Promise<Sep6Transaction> {
  const url = new URL("/sep6/transaction", cfg.ANCHOR_URL);
  url.searchParams.set("id", id);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${jwt}` } });
  if (res.status === 401 || res.status === 403) {
    throw Object.assign(new Error("anchor rejected the SEP-10 token"), { status: 401 });
  }
  if (res.status === 404) {
    throw Object.assign(new Error("anchor has no such transaction"), { status: 404 });
  }
  if (!res.ok) throw new Error(`anchor returned ${res.status}`);
  const body = (await res.json()) as { transaction: Sep6Transaction };
  return body.transaction;
}

/** The account the SEP-10 token belongs to, per the anchor's own answer. */
export async function accountForToken(cfg: Config, jwt: string): Promise<string | null> {
  const payload = jwt.split(".")[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      sub?: string;
    };
    const base = claims.sub?.split(":")[0];
    return base && /^[GM][A-Z2-7]{55,}$/.test(base) ? base : null;
  } catch {
    return null;
  }
}
