import { useState } from "react";

import { addUsdcTrustline, fundWithFriendbot, type AccountState } from "../lib/account";
import { isTestnet } from "../lib/config";
import { num, t, useT } from "../lib/i18n";
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
      message: t("req.noAccount"),
      ...(isTestnet ? { fix: "friendbot" as const } : {}),
    });
    return blockers;
  }
  if (!account.hasUsdcTrustline) {
    blockers.push({ message: t("req.noTrustlineBuy"), fix: "trustline" });
  }
  const needed = stakeXlm + 1.5; // stake + fees + a little reserve headroom
  if (account.xlmSpendable < needed) {
    blockers.push({
      message: t("req.needXlm", {
        needed: num(needed, 0, 2),
        have: num(account.xlmSpendable, 0, 2),
      }),
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
      message: t("req.noAccount"),
      ...(isTestnet ? { fix: "friendbot" as const } : {}),
    });
    return blockers;
  }
  if (!account.hasUsdcTrustline) {
    blockers.push({ message: t("req.noTrustline"), fix: "trustline" });
  } else if (usdcNeeded > 0 && account.usdc < usdcNeeded) {
    blockers.push({
      message: t("req.needUsdc", {
        needed: num(usdcNeeded, 0, 2),
        have: num(account.usdc, 0, 2),
      }),
    });
  }
  if (account.xlmSpendable < 1) {
    blockers.push({
      message: t("req.needFeeXlm"),
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
  const t = useT();
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
      <p className="text-xs font-medium">{t("req.before")}</p>
      {blockers.map((blocker) => (
        <div key={blocker.message} className="flex flex-wrap items-center gap-2">
          <p className="flex-1 text-xs text-muted-foreground">{blocker.message}</p>
          {blocker.fix && (
            <Button
              variant="ghost"
              loading={busy === blocker.fix}
              onClick={() => void fix(blocker.fix!)}
            >
              {blocker.fix === "trustline" ? t("req.addTrustline") : t("req.fundFriendbot")}
            </Button>
          )}
        </div>
      ))}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
