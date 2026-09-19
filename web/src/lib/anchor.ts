import { Transaction } from "@stellar/stellar-sdk";

import { config } from "./config";
import { signXdr } from "./wallet";

/**
 * SEP-10 against the anchor, straight from the browser.
 *
 * The token belongs to the user's wallet and only the wallet can obtain it —
 * every SEP-6 and SEP-12 call in the deposit and withdrawal flows carries it.
 */
/**
 * Turn an anchor error response into something a person can act on.
 *
 * The anchor is specific — "bank_account_number must be a valid Turkish IBAN"
 * — and replacing that with a status code throws the only useful part away.
 */
async function anchorError(res: Response, fallback: string): Promise<Error> {
  let detail = "";
  try {
    const body = (await res.json()) as { error?: string; message?: string };
    detail = body.error ?? body.message ?? "";
  } catch {
    detail = (await res.text().catch(() => "")).slice(0, 200);
  }
  if (res.status === 401 || res.status === 403) {
    return new Error("Anchor oturumu geçersiz. Cüzdanı ayırıp yeniden bağlanın.");
  }
  return new Error(detail ? `${fallback}: ${detail}` : `${fallback} (${res.status})`);
}

export async function authenticate(address: string): Promise<string> {
  const url = new URL("/auth", config.anchorUrl);
  url.searchParams.set("account", address);
  url.searchParams.set("home_domain", config.anchorHomeDomain);

  const challengeRes = await fetch(url);
  if (!challengeRes.ok) throw await anchorError(challengeRes, "Anchor challenge alınamadı");
  const challenge = (await challengeRes.json()) as {
    transaction: string;
    network_passphrase?: string;
  };
  if (
    challenge.network_passphrase &&
    challenge.network_passphrase !== config.networkPassphrase
  ) {
    throw new Error("Anchor farklı bir ağ için challenge gönderdi");
  }

  // The challenge is a sequence-0 transaction that can never be submitted, but
  // we still show the wallet prompt — the user must consent to proving identity.
  const tx = new Transaction(challenge.transaction, config.networkPassphrase);
  if (tx.sequence !== "0") throw new Error("Challenge geçersiz: sequence 0 olmalı");
  const signed = await signXdr(challenge.transaction, address);

  const tokenRes = await fetch(new URL("/auth", config.anchorUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transaction: signed }),
  });
  if (!tokenRes.ok) throw await anchorError(tokenRes, "Anchor kimlik doğrulamasını reddetti");
  return ((await tokenRes.json()) as { token: string }).token;
}

/**
 * Register the customer with the anchor. This mock anchor accepts an empty
 * body and flips straight to ACCEPTED, so it runs quietly in the background
 * instead of putting a KYC form in front of the user.
 *
 * SEP-12 answers a PUT with `202 {id}` and nothing else — the status only
 * comes back from a GET, so read it there rather than from the write.
 */
export async function putCustomer(
  jwt: string,
  address: string,
  fields: Record<string, string> = {},
): Promise<{ id: string }> {
  const res = await fetch(new URL("/sep12/customer", config.anchorUrl), {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ account: address, ...fields }),
  });
  if (!res.ok) throw await anchorError(res, "SEP-12 kaydı başarısız");
  return (await res.json()) as { id: string };
}

export interface Sep12Customer {
  id?: string;
  status?: string;
  message?: string;
}

/** Read the customer's KYC status. This is where `status` actually lives. */
export async function getCustomer(jwt: string, address: string): Promise<Sep12Customer> {
  const url = new URL("/sep12/customer", config.anchorUrl);
  url.searchParams.set("account", address);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${jwt}` } });
  if (!res.ok) throw await anchorError(res, "SEP-12 durumu okunamadı");
  return (await res.json()) as Sep12Customer;
}

export interface AnchorPrice {
  price: string;
  total_price: string;
  sell_amount: string;
  buy_amount: string;
}

/** Indicative TRY per 1 USDC, used to show how far an offer sits from market. */
export async function indicativePrice(buyAmountUsdc = "1"): Promise<AnchorPrice> {
  const url = new URL("/sep38/price", config.anchorUrl);
  url.searchParams.set("sell_asset", "iso4217:TRY");
  url.searchParams.set("buy_asset", `stellar:USDC:${config.usdcIssuer}`);
  url.searchParams.set("buy_amount", buyAmountUsdc);
  url.searchParams.set("context", "sep6");
  url.searchParams.set("sell_delivery_method", "bank_account");

  const res = await fetch(url);
  if (!res.ok) throw await anchorError(res, "Anchor fiyatı alınamadı");
  return (await res.json()) as AnchorPrice;
}
