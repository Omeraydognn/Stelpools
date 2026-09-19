import { useState } from "react";

import { addUsdcTrustline, fundWithFriendbot, type AccountState } from "../lib/account";
import { isTestnet } from "../lib/config";
import { isUserRejection } from "../lib/wallet";
import { Button } from "./ui";

export interface Blocker {
  message: string;
  /** Rendered as the fix button when the app can do something about it. */
  fix?: "trustline" | "friendbot";
}

/**
 * What stops this wallet from going through with the swap, and how to fix it.
 *
 * These checks run against the account before anything is signed. A wallet
 * with no USDC trustline or no XLM for the stake would otherwise discover the
 * problem as a failed transaction — for a taker, possibly after they had
 * already sent the lira.
 */
export function blockersForBuy(account: AccountState | null, stakeXlm = 10): Blocker[] {
  if (!account) return [];
  const blockers: Blocker[] = [];
  if (!account.exists) {
    blockers.push({
      message: "Cüzdan hesabınız bu ağda yok. Testnet'te friendbot ile oluşturabilirsiniz.",
      ...(isTestnet ? { fix: "friendbot" as const } : {}),
    });
    return blockers;
  }
  if (!account.hasUsdcTrustline) {
    blockers.push({
      message: "USDC'yi alabilmek için cüzdanınızda USDC trustline olmalı.",
      fix: "trustline",
    });
  }
  const needed = stakeXlm + 1.5; // stake + fees + a little reserve headroom
  if (account.xlmSpendable < needed) {
    blockers.push({
      message: `Teminat ve ücretler için ~${needed.toLocaleString("tr-TR")} XLM gerekiyor, kullanılabilir bakiyeniz ${account.xlmSpendable.toLocaleString("tr-TR", { maximumFractionDigits: 2 })} XLM.`,
      ...(isTestnet ? { fix: "friendbot" as const } : {}),
    });
  }
  return blockers;
}

export function blockersForProvide(
  account: AccountState | null,
  usdcNeeded: number,
): Blocker[] {
  if (!account) return [];
  const blockers: Blocker[] = [];
  if (!account.exists) {
    blockers.push({
      message: "Cüzdan hesabınız bu ağda yok. Testnet'te friendbot ile oluşturabilirsiniz.",
      ...(isTestnet ? { fix: "friendbot" as const } : {}),
    });
    return blockers;
  }
  if (!account.hasUsdcTrustline) {
    blockers.push({ message: "Cüzdanınızda USDC trustline yok.", fix: "trustline" });
  } else if (usdcNeeded > 0 && account.usdc < usdcNeeded) {
    blockers.push({
      message: `Havuza ${usdcNeeded.toLocaleString("tr-TR")} USDC eklemek istiyorsunuz ama bakiyeniz ${account.usdc.toLocaleString("tr-TR", { maximumFractionDigits: 2 })} USDC.`,
    });
  }
  if (account.xlmSpendable < 1) {
    blockers.push({
      message: "İşlem ücretleri için biraz XLM gerekiyor.",
      ...(isTestnet ? { fix: "friendbot" as const } : {}),
    });
  }
  return blockers;
}

export function BlockerList({
  blockers,
  address,
  onFixed,
}: {
  blockers: Blocker[];
  address: string;
  onFixed: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (blockers.length === 0) return null;

  async function fix(kind: NonNullable<Blocker["fix"]>) {
    setBusy(kind);
    setError(null);
    try {
      if (kind === "trustline") await addUsdcTrustline(address);
      else await fundWithFriendbot(address);
      onFixed();
    } catch (err) {
      if (!isUserRejection(err)) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      role="status"
      className="grid gap-2 rounded-[var(--radius)] border border-destructive/40 bg-destructive/10 p-3"
    >
      <p className="text-xs font-medium">Devam etmeden önce:</p>
      {blockers.map((blocker) => (
        <div key={blocker.message} className="flex flex-wrap items-center gap-2">
          <p className="flex-1 text-xs text-muted-foreground">{blocker.message}</p>
          {blocker.fix && (
            <Button
              variant="ghost"
              loading={busy === blocker.fix}
              onClick={() => void fix(blocker.fix!)}
            >
              {blocker.fix === "trustline" ? "USDC'yi tanımla" : "Friendbot ile fonla"}
            </Button>
          )}
        </div>
      ))}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
