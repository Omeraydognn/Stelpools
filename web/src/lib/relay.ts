import { config } from "./config";

export interface AdvanceResult {
  account: string;
  paid_out_usdc: string;
  owed_usdc: string;
  tx_hash: string;
}

export const relayEnabled = () => config.relayUrl !== "";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${config.relayUrl}${path}`, init);
  } catch {
    throw new Error("Anında ödeme servisine ulaşılamıyor.");
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
    throw new Error(body.message ?? body.error ?? `Relay hatası ${res.status}`);
  }
  return (await res.json()) as T;
}

/**
 * Ask the vault to front a deposit the anchor has accepted.
 *
 * The relay checks the anchor's own record of the transaction before the
 * vault pays anything — it is the component that decides the pool is good
 * for this claim, which is why it is a trusted one.
 */
export const requestAdvance = (jwt: string, transactionId: string) =>
  call<AdvanceResult>("/advance", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jwt, transaction_id: transactionId }),
  });

export const relayHealth = () =>
  call<{ ok: boolean; liquid_usdc: string; advanced_usdc: string; max_advance_usdc: number }>(
    "/health",
  );
