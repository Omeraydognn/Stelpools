import type { Sep6Transaction } from "./anchor.js";

/** States in which the anchor has taken the lira but not yet sent the USDC. */
const FRONTABLE = new Set([
  "pending_anchor",
  "pending_stellar",
  "pending_trust",
  "pending_user_transfer_complete",
  "completed",
]);

export interface Verdict {
  ok: boolean;
  reason?: string;
  /** USDC the anchor owes this user, in stroops. */
  amountStroops?: bigint;
}

/**
 * Decide whether the vault may front this deposit.
 *
 * The rule is deliberately narrow: the deposit must belong to the account
 * asking, the anchor must already be on the hook for it, and the amount must
 * be one the anchor has actually quoted. Anything the relay cannot verify
 * from the anchor's own record is a no.
 */
export function assess(
  txn: Sep6Transaction,
  account: string,
  maxUsdc: number,
  alreadyOwed: bigint,
): Verdict {
  if (txn.kind && txn.kind !== "deposit") {
    return { ok: false, reason: "Bu bir yatırma işlemi değil." };
  }
  if (txn.to && txn.to !== account) {
    return { ok: false, reason: "Bu işlem başka bir hesaba ait." };
  }
  if (!FRONTABLE.has(txn.status)) {
    return { ok: false, reason: `Anchor işlemi "${txn.status}" durumunda, önden verilemez.` };
  }
  if (alreadyOwed > 0n) {
    return { ok: false, reason: "Bu hesabın kapatılmamış bir avansı var." };
  }

  const amount = Number(txn.amount_out ?? "0");
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, reason: "Anchor bu işlem için bir USDC tutarı bildirmedi." };
  }
  if (amount > maxUsdc) {
    return { ok: false, reason: `Tek seferde en fazla ${maxUsdc} USDC önden verilebilir.` };
  }

  return { ok: true, amountStroops: BigInt(Math.round(amount * 1e7)) };
}
