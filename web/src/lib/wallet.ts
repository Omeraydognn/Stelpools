import { Networks, StellarWalletsKit } from "@creit.tech/stellar-wallets-kit";
import { AlbedoModule } from "@creit.tech/stellar-wallets-kit/modules/albedo";
import { FREIGHTER_ID, FreighterModule } from "@creit.tech/stellar-wallets-kit/modules/freighter";
import { HanaModule } from "@creit.tech/stellar-wallets-kit/modules/hana";
import { LobstrModule } from "@creit.tech/stellar-wallets-kit/modules/lobstr";
import { RabetModule } from "@creit.tech/stellar-wallets-kit/modules/rabet";
import { xBullModule } from "@creit.tech/stellar-wallets-kit/modules/xbull";

import { forgetToken } from "./auth";
import { config, isTestnet } from "./config";
import { t } from "./i18n";

const STORAGE_KEY = "usdc-vault:wallet-id";

// Browser wallets only — no WalletConnect or hardware, which would ask the
// user to set up more than a testnet demo warrants.
StellarWalletsKit.init({
  network: isTestnet ? Networks.TESTNET : Networks.PUBLIC,
  selectedWalletId: localStorage.getItem(STORAGE_KEY) ?? FREIGHTER_ID,
  modules: [
    new FreighterModule(),
    new xBullModule(),
    new AlbedoModule(),
    new LobstrModule(),
    new RabetModule(),
    new HanaModule(),
  ],
});

/** The user closing the wallet modal is a state change, not a failure. */
export class WalletCancelled extends Error {
  constructor() {
    super(t("wallet.rejected"));
    this.name = "WalletCancelled";
  }
}

/** Opens the wallet picker and returns the chosen address. */
export async function connectWallet(): Promise<string> {
  const { address } = await StellarWalletsKit.authModal();
  if (!address) throw new WalletCancelled();
  try {
    localStorage.setItem(STORAGE_KEY, StellarWalletsKit.selectedModule.productId);
  } catch {
    // A blocked localStorage only costs us the reconnect-on-refresh nicety.
  }
  return address;
}

/**
 * Re-attach to the wallet picked last time without opening the modal. Returns
 * null when nothing is connected or the wallet is locked — both ordinary
 * states, not errors.
 */
export async function restoreWallet(): Promise<string | null> {
  const id = localStorage.getItem(STORAGE_KEY);
  if (!id) return null;
  try {
    StellarWalletsKit.setWallet(id);
    // `skipRequestAccess` is the difference between quietly reading an
    // already-granted address and popping the wallet open on every page
    // load. The kit's own fetchAddress always asks, so go to the module.
    const { address } = await StellarWalletsKit.selectedModule.getAddress({
      skipRequestAccess: true,
    });
    return address || null;
  } catch {
    // Not granted, locked, or a different wallet — the user connects manually.
    return null;
  }
}

export function forgetWallet(address?: string): void {
  localStorage.removeItem(STORAGE_KEY);
  if (address) forgetToken(address);
  void StellarWalletsKit.disconnect().catch(() => undefined);
}

/** Signs a transaction XDR and returns the signed XDR. */
export async function signXdr(xdr: string, address: string): Promise<string> {
  const { signedTxXdr } = await StellarWalletsKit.signTransaction(xdr, {
    address,
    networkPassphrase: config.networkPassphrase,
  });
  return signedTxXdr;
}

/** Wallets report rejection in a dozen different ways; normalise it. */
export function isUserRejection(err: unknown): boolean {
  if (err instanceof WalletCancelled) return true;
  const message = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    message.includes("reject") ||
    message.includes("denied") ||
    message.includes("declined") ||
    message.includes("cancel") ||
    message.includes("closed")
  );
}
