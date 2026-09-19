import { useState } from "react";

import { addUsdcTrustline } from "../lib/account";
import { listTransactions, type Sep6Transaction } from "../lib/sep6";
import { useAsync } from "../lib/useAsync";
import { isUserRejection } from "../lib/wallet";
import { Button, Card, ErrorState, Skeleton } from "./ui";

const STATUS_COPY: Record<string, string> = {
  completed: "Tamamlandı",
  pending_anchor: "Anchor işliyor",
  pending_stellar: "Ağa gönderiliyor",
  pending_trust: "USDC trustline bekleniyor",
  pending_user_transfer_start: "Paranız bekleniyor",
  pending_user_transfer_complete: "Transfer alındı",
  incomplete: "Tamamlanmadı",
  error: "Hata",
  refunded: "İade edildi",
  expired: "Süresi doldu",
};

const DONE = new Set(["completed", "refunded", "expired", "error"]);

function when(txn: Sep6Transaction): string {
  const iso = txn.completed_at ?? txn.started_at;
  if (!iso) return "";
  return new Date(iso).toLocaleString("tr-TR", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * The anchor's own ledger for this wallet.
 *
 * The app polls a ramp while it is in flight, but the moment the tab is
 * closed or a request is lost that thread is gone — and the user is left
 * guessing. This reads the anchor directly, so the truth is always one
 * refresh away.
 */
export function AnchorActivity({ address }: { address: string }) {
  // `false` keeps this off the wallet: on a timer it reads only a token that
  // already exists, and returns null when there is none.
  const txns = useAsync(() => listTransactions(address, false), [address], 30_000);
  const [authorising, setAuthorising] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const needsAuth = txns.data === null && !txns.loading;
  const items = (txns.data ?? []).slice(0, 6);
  const stuck = items.find((t) => t.status === "pending_trust");

  return (
    <Card className="grid gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium">Anchor işlemleriniz</h3>
        {!needsAuth && (
          <Button variant="ghost" onClick={txns.reload} loading={txns.loading && !txns.initial}>
            Yenile
          </Button>
        )}
      </div>

      {txns.initial && txns.loading && <Skeleton className="h-16" />}
      {txns.error && <ErrorState error={txns.error} onRetry={txns.reload} />}

      {needsAuth && (
        <div className="grid gap-2">
          <p className="text-xs text-muted-foreground">
            Anchor kayıtlarınızı okumak için bir kez cüzdan imzası gerekiyor. İmza yalnızca
            kimliğinizi kanıtlar; hiçbir para hareket etmez.
          </p>
          <Button
            variant="ghost"
            className="justify-self-start"
            loading={authorising}
            onClick={async () => {
              setAuthorising(true);
              setAuthError(null);
              try {
                await listTransactions(address, true);
                txns.reload();
              } catch (err) {
                if (!isUserRejection(err)) {
                  setAuthError(err instanceof Error ? err.message : String(err));
                }
              } finally {
                setAuthorising(false);
              }
            }}
          >
            Anchor işlemlerimi göster
          </Button>
          {authError && <p className="text-xs text-destructive">{authError}</p>}
        </div>
      )}

      {txns.data && items.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Anchor üzerinden henüz bir TL giriş/çıkışınız yok.
        </p>
      )}

      {items.length > 0 && (
        <ul className="grid list-none gap-2 p-0">
          {items.map((txn) => {
            const inFlight = !DONE.has(txn.status);
            return (
              <li
                key={txn.id}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border pb-2 text-xs last:border-0 last:pb-0"
              >
                <span className="font-medium">
                  {txn.kind === "withdrawal" ? "USDC → TRY" : "TRY → USDC"}
                </span>
                <span className="tnum text-muted-foreground">
                  {txn.amount_in ?? "—"} → {txn.amount_out ?? "—"}
                </span>
                <span className={inFlight ? "text-primary" : "text-muted-foreground"}>
                  {STATUS_COPY[txn.status] ?? txn.status}
                </span>
                <span className="tnum ml-auto text-muted-foreground">{when(txn)}</span>
                {txn.message && (
                  <span className="w-full text-muted-foreground">Anchor: {txn.message}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {stuck && (
        <div className="grid gap-2 rounded-[var(--radius)] border border-destructive/40 bg-destructive/10 p-3 text-xs">
          <p>
            Bir işleminiz USDC trustline bekliyor. Açtığınız anda anchor kaldığı yerden devam
            eder — para kaybolmadı.
          </p>
          <Button
            variant="ghost"
            className="justify-self-start"
            onClick={async () => {
              await addUsdcTrustline(address);
              txns.reload();
            }}
          >
            USDC trustline'ı aç
          </Button>
        </div>
      )}
    </Card>
  );
}
