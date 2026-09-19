import { Asset, Memo, Operation, TransactionBuilder } from "@stellar/stellar-sdk";

import { USDC, horizon } from "./account";
import { putCustomer } from "./anchor";
import { getToken, peekToken, withToken } from "./auth";
import { config } from "./config";
import { signXdr } from "./wallet";

export type RampStage =
  | "authenticating"
  | "registering"
  | "requesting"
  | "transferring"
  | "waiting"
  | "done";

export interface RampProgress {
  (stage: RampStage, detail?: RampDetail): void;
}

export interface RampDetail {
  /** The anchor's own status, e.g. `pending_anchor`, `pending_trust`. */
  status: string;
  /** The anchor's own message. It usually says exactly what is missing. */
  message?: string;
  /** True while the anchor is blocked on a missing USDC trustline. */
  needsTrustline: boolean;
  elapsedSeconds: number;
}

export interface Sep6Transaction {
  id: string;
  status: string;
  pending_reason?: string;
  amount_in?: string;
  amount_out?: string;
  message?: string;
  withdraw_anchor_account?: string;
  withdraw_memo?: string;
  withdraw_memo_type?: string;
  kind?: string;
  amount_in_asset?: string;
  amount_out_asset?: string;
  started_at?: string;
  completed_at?: string;
}

async function anchorFetch<T>(path: string, jwt: string, init?: RequestInit): Promise<T> {
  const res = await fetch(new URL(path, config.anchorUrl), {
    ...init,
    headers: { Authorization: `Bearer ${jwt}`, ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Anchor ${res.status} döndürdü`);
  }
  return (await res.json()) as T;
}

/** Ten minutes: a real bank leg is slow, and `pending_trust` waits on a human. */
const MAX_WAIT_MS = 10 * 60 * 1000;
const POLL_MS = 2_500;

async function waitForCompletion(
  jwt: string,
  id: string,
  onProgress?: RampProgress,
): Promise<Sep6Transaction> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < MAX_WAIT_MS) {
    const { transaction } = await anchorFetch<{ transaction: Sep6Transaction }>(
      `/sep6/transaction?id=${encodeURIComponent(id)}`,
      jwt,
    );

    // The anchor says what it is waiting for; pass it straight through
    // rather than replacing it with a spinner.
    onProgress?.("waiting", {
      status: transaction.status,
      ...(transaction.message ? { message: transaction.message } : {}),
      needsTrustline: transaction.status === "pending_trust",
      elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
    });

    if (transaction.status === "completed") return transaction;
    if (transaction.status.startsWith("error")) {
      throw new Error(transaction.message ?? "Anchor işlemi başarısız oldu.");
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  throw new Error(
    "Anchor 10 dakikada tamamlamadı. İşlem iptal olmadı — anchor tarafında beklemeye devam ediyor.",
  );
}

/**
 * TRY → USDC through the anchor (SEP-10 → SEP-12 → SEP-6 deposit).
 *
 * In the sandbox the lira leg is a simulated bank transfer; against a real
 * anchor the user would send a FAST transfer to the IBAN the deposit returns
 * and this step would simply wait longer.
 */
export interface DepositInstructions {
  /** The anchor's own bank account — where the lira actually goes. */
  iban: string;
  bankName: string;
  /** The reference the transfer description must carry. */
  reference: string;
  amountTry: string;
  /** What the user will receive, as the anchor quoted it. */
  amountUsdc: string | null;
}

/** `instructions` comes back as {field: {value, description}}. */
type InstructionMap = Record<string, { value?: string } | undefined>;

export async function openDeposit(
  address: string,
  tryAmount: string,
  onProgress?: RampProgress,
): Promise<{ jwt: string; id: string; instructions: DepositInstructions }> {
  onProgress?.("authenticating");

  const { jwt, id, instructions } = await withToken(address, async (token) => {
    onProgress?.("registering");
    await putCustomer(token, address);

    onProgress?.("requesting");
    const params = new URLSearchParams({
      asset_code: "USDC",
      account: address,
      type: "bank_account",
      amount: tryAmount,
    });
    const deposit = await anchorFetch<{ id?: string; instructions?: InstructionMap }>(
      `/sep6/deposit?${params}`,
      token,
    );
    if (!deposit.id) throw new Error("Anchor bir işlem numarası döndürmedi.");

    const field = (name: string) => deposit.instructions?.[name]?.value ?? "";
    return {
      jwt: token,
      id: deposit.id,
      instructions: {
        iban: field("bank_account_number"),
        bankName: field("bank_name"),
        reference: field("external_transfer_memo"),
        amountTry: tryAmount,
        amountUsdc: null,
      },
    };
  });

  // The transfer itself is the user's to make: the anchor has given us its
  // IBAN and a reference, and nothing moves until the lira actually arrives.
  return { jwt, id, instructions };
}

/**
 * Sandbox only: tell the anchor to pretend the bank transfer landed.
 *
 * Against a live anchor this call does not exist — the user sends a FAST
 * transfer to the IBAN above and the anchor notices it. Keeping it as a
 * separate, clearly-labelled step means the demo shows the real sequence
 * instead of skipping the part that matters.
 */
export async function simulateBankTransfer(jwt: string, id: string): Promise<void> {
  await anchorFetch(`/sep6/tx/${id}/simulate-bank-transfer`, jwt, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
}

/** Wait for the anchor to actually deliver the USDC. */
export async function awaitDeposit(
  jwt: string,
  id: string,
  onProgress?: RampProgress,
): Promise<{ usdc: string; id: string }> {
  const done = await waitForCompletion(jwt, id, onProgress);
  onProgress?.("done");
  return { usdc: done.amount_out ?? "0", id: done.id };
}

/** Open, simulate and wait — the sandbox shortcut, used by the vault tab. */
export async function depositTry(
  address: string,
  tryAmount: string,
  onProgress?: RampProgress,
): Promise<{ usdc: string; id: string }> {
  const { jwt, id } = await openDeposit(address, tryAmount, onProgress);
  onProgress?.("transferring");
  await simulateBankTransfer(jwt, id);
  return awaitDeposit(jwt, id, onProgress);
}

/**
 * USDC → TRY through the anchor (SEP-10 → SEP-12 with the IBAN → SEP-6
 * withdraw → a USDC payment to the anchor's treasury carrying the memo it
 * gave us). The anchor then pays the lira out to that IBAN.
 */
export async function withdrawToIban(
  address: string,
  usdcAmount: string,
  iban: string,
  bankName: string,
  onProgress?: RampProgress,
): Promise<{ try: string; id: string }> {
  onProgress?.("authenticating");

  const { jwt, withdrawal } = await withToken(address, async (token) => {
    onProgress?.("registering");
    // The anchor pays out to the IBAN on the customer record, so it has to be
    // registered before the withdrawal is opened.
    await putCustomer(token, address, {
      bank_account_number: iban,
      bank_name: bankName || "Bank",
    });

    onProgress?.("requesting");
    const params = new URLSearchParams({
      asset_code: "USDC",
      type: "bank_account",
      amount: usdcAmount,
      dest: iban,
    });
    return {
      jwt: token,
      withdrawal: await anchorFetch<Sep6Transaction & { account_id?: string; memo?: string }>(
        `/sep6/withdraw?${params}`,
        token,
      ),
    };
  });

  const destination = withdrawal.account_id ?? withdrawal.withdraw_anchor_account;
  const memo = withdrawal.memo ?? withdrawal.withdraw_memo;
  if (!destination || !memo) throw new Error("Anchor hazine adresi veya memo döndürmedi.");

  onProgress?.("transferring");
  const account = await horizon.loadAccount(address);
  const tx = new TransactionBuilder(account, {
    fee: "10000",
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(
      Operation.payment({
        destination,
        asset: USDC as Asset,
        amount: usdcAmount,
      }),
    )
    .addMemo(Memo.id(String(memo)))
    .setTimeout(120)
    .build();

  const signed = await signXdr(tx.toXDR(), address);
  await horizon.submitTransaction(
    TransactionBuilder.fromXDR(signed, config.networkPassphrase),
  );

  const done = await waitForCompletion(jwt, withdrawal.id, onProgress);
  onProgress?.("done");
  return { try: done.amount_out ?? "0", id: done.id };
}

/**
 * Everything the anchor has on record for this account.
 *
 * A ramp that looks stuck is nearly always the anchor waiting on something,
 * and it will say so here. Showing this list means nobody has to guess
 * whether their money moved.
 */
export async function listTransactions(
  address: string,
  /** Pass false on a timer: a poll must never open the wallet. */
  mayAuthenticate = false,
): Promise<Sep6Transaction[] | null> {
  const jwt = mayAuthenticate ? await getToken(address) : peekToken(address);
  // No token and not allowed to ask for one: the caller shows a button.
  if (!jwt) return null;
  const body = await anchorFetch<{ transactions: Sep6Transaction[] }>(
    "/sep6/transactions?asset_code=USDC",
    jwt,
  );
  return body.transactions ?? [];
}
