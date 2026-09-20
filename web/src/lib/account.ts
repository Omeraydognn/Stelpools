import { Asset, Horizon, Operation, TransactionBuilder } from "@stellar/stellar-sdk";

import { config } from "./config";
import { signXdr } from "./wallet";
import { t } from "./i18n";

export const horizon = new Horizon.Server(config.horizonUrl);
export const USDC = new Asset("USDC", config.usdcIssuer);
export const ATRY = new Asset(config.atryCode, config.atryIssuer);

/** The two sides of the pool, so a caller can name one without a string. */
export type Side = "usdc" | "atry";

export const assetFor = (side: Side): Asset => (side === "usdc" ? USDC : ATRY);

export interface AccountState {
  /** False when the account has never been funded on this network. */
  exists: boolean;
  /** Native balance, in XLM. */
  xlm: number;
  /** Spendable XLM after the base reserve and subentry reserves. */
  xlmSpendable: number;
  usdc: number;
  atry: number;
  hasUsdcTrustline: boolean;
  hasAtryTrustline: boolean;
}

const EMPTY: AccountState = {
  exists: false,
  xlm: 0,
  xlmSpendable: 0,
  usdc: 0,
  atry: 0,
  hasUsdcTrustline: false,
  hasAtryTrustline: false,
};

/**
 * What the wallet can actually do right now.
 *
 * Every blocker the swap card reports comes from here, so the user learns
 * what is missing before they sign rather than from a failed transaction.
 * Both sides of the pair matter: a swap needs somewhere to put what it
 * receives, and the anchor cannot deliver aTRY to an account that has not
 * agreed to hold it.
 */
export async function loadAccount(address: string): Promise<AccountState> {
  let account: Horizon.AccountResponse;
  try {
    account = await horizon.loadAccount(address);
  } catch (err) {
    if ((err as { response?: { status?: number } }).response?.status === 404) return EMPTY;
    throw err;
  }

  const native = account.balances.find((b) => b.asset_type === "native");
  const find = (code: string, issuer: string) =>
    account.balances.find(
      (b) => "asset_code" in b && b.asset_code === code && b.asset_issuer === issuer,
    );
  const usdc = find("USDC", config.usdcIssuer);
  const atry = find(config.atryCode, config.atryIssuer);

  const xlm = native ? Number(native.balance) : 0;
  // Base reserve is 0.5 XLM, plus 0.5 per subentry (trustlines, offers…).
  const reserved = 1 + 0.5 * account.subentry_count;

  return {
    exists: true,
    xlm,
    xlmSpendable: Math.max(0, xlm - reserved),
    usdc: usdc && "balance" in usdc ? Number(usdc.balance) : 0,
    atry: atry && "balance" in atry ? Number(atry.balance) : 0,
    hasUsdcTrustline: Boolean(usdc),
    hasAtryTrustline: Boolean(atry),
  };
}

/**
 * Agree to hold one of the pair.
 *
 * On Stellar an account holds nothing it has not opted into, so this is the
 * step that has to happen before the anchor can deliver aTRY or the pool
 * can pay out USDC. Doing it here, from a named button, is far kinder than
 * letting it surface as a failed payment later.
 */
export async function addTrustline(address: string, side: Side): Promise<string> {
  const account = await horizon.loadAccount(address);
  const tx = new TransactionBuilder(account, {
    fee: "10000",
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(Operation.changeTrust({ asset: assetFor(side) }))
    .setTimeout(120)
    .build();

  const signed = await signXdr(tx.toXDR(), address);
  const result = await horizon.submitTransaction(
    TransactionBuilder.fromXDR(signed, config.networkPassphrase),
  );
  return result.hash;
}

/** Both at once, so a new wallet is one signature from being ready. */
export async function addBothTrustlines(address: string): Promise<string> {
  const account = await horizon.loadAccount(address);
  const state = await loadAccount(address);
  const builder = new TransactionBuilder(account, {
    fee: "20000",
    networkPassphrase: config.networkPassphrase,
  });
  if (!state.hasUsdcTrustline) builder.addOperation(Operation.changeTrust({ asset: USDC }));
  if (!state.hasAtryTrustline) builder.addOperation(Operation.changeTrust({ asset: ATRY }));

  const tx = builder.setTimeout(120).build();
  const signed = await signXdr(tx.toXDR(), address);
  const result = await horizon.submitTransaction(
    TransactionBuilder.fromXDR(signed, config.networkPassphrase),
  );
  return result.hash;
}

export const addUsdcTrustline = (address: string) => addTrustline(address, "usdc");
export const addAtryTrustline = (address: string) => addTrustline(address, "atry");

/** Testnet only: ask friendbot for XLM. */
export async function fundWithFriendbot(address: string): Promise<void> {
  const res = await fetch(`https://friendbot.stellar.org?addr=${encodeURIComponent(address)}`);
  if (!res.ok) throw new Error(t("err.friendbot", { status: res.status }));
}
