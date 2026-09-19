import { Asset, Horizon, Operation, TransactionBuilder } from "@stellar/stellar-sdk";

import { config } from "./config";
import { signXdr } from "./wallet";

export const horizon = new Horizon.Server(config.horizonUrl);
export const USDC = new Asset("USDC", config.usdcIssuer);

export interface AccountState {
  /** False when the account has never been funded on this network. */
  exists: boolean;
  /** Native balance, in XLM. */
  xlm: number;
  /** Spendable XLM after the base reserve and subentry reserves. */
  xlmSpendable: number;
  usdc: number;
  hasUsdcTrustline: boolean;
}

const EMPTY: AccountState = {
  exists: false,
  xlm: 0,
  xlmSpendable: 0,
  usdc: 0,
  hasUsdcTrustline: false,
};

/**
 * What the wallet can actually do right now.
 *
 * Every blocker the swap card reports comes from here, so the user learns
 * what is missing before they sign rather than from a failed transaction.
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
  const usdc = account.balances.find(
    (b) => "asset_code" in b && b.asset_code === "USDC" && b.asset_issuer === config.usdcIssuer,
  );

  const xlm = native ? Number(native.balance) : 0;
  // Base reserve is 0.5 XLM, plus 0.5 per subentry (trustlines, offers…).
  const reserved = 1 + 0.5 * account.subentry_count;

  return {
    exists: true,
    xlm,
    xlmSpendable: Math.max(0, xlm - reserved),
    usdc: usdc && "balance" in usdc ? Number(usdc.balance) : 0,
    hasUsdcTrustline: Boolean(usdc),
  };
}

/**
 * Open a USDC trustline. Without one the account cannot hold USDC at all, so
 * a taker's swap would fail at payout time — after they had already sent lira.
 */
export async function addUsdcTrustline(address: string): Promise<string> {
  const account = await horizon.loadAccount(address);
  const tx = new TransactionBuilder(account, {
    fee: "10000",
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(Operation.changeTrust({ asset: USDC }))
    .setTimeout(120)
    .build();

  const signed = await signXdr(tx.toXDR(), address);
  const result = await horizon.submitTransaction(
    TransactionBuilder.fromXDR(signed, config.networkPassphrase),
  );
  return result.hash;
}

/** Testnet only: ask friendbot for XLM. */
export async function fundWithFriendbot(address: string): Promise<void> {
  const res = await fetch(`https://friendbot.stellar.org?addr=${encodeURIComponent(address)}`);
  if (!res.ok) throw new Error(`Friendbot hesabı fonlayamadı (${res.status})`);
}
