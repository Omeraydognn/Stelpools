import { useState } from "react";

import { addUsdcTrustline } from "../lib/account";
import type { RampDetail, RampStage } from "../lib/sep6";
import { isUserRejection } from "../lib/wallet";
import { Button } from "./ui";

const STAGE_COPY: Record<RampStage, string> = {
  authenticating: "Anchor'a bağlanılıyor…",
  registering: "Kimlik kaydı yapılıyor…",
  requesting: "Anchor işlemi açılıyor…",
  transferring: "Transfer gönderiliyor…",
  waiting: "Anchor işliyor…",
  done: "Tamamlandı",
};

/** The anchor's own vocabulary, in plain Turkish. */
const STATUS_COPY: Record<string, string> = {
  pending_user_transfer_start: "Anchor paranızı bekliyor.",
  pending_user_transfer_complete: "Transferiniz alındı, anchor işliyor.",
  pending_anchor: "Anchor TRY'yi aldı, USDC'yi gönderiyor.",
  pending_stellar: "Ödeme Stellar ağına gönderiliyor.",
  pending_trust: "Anchor USDC'yi gönderemiyor: cüzdanınızda USDC trustline yok.",
  pending_receiver: "Anchor ödemeyi hazırlıyor.",
  completed: "Tamamlandı.",
};

/**
 * What the anchor is actually doing, rather than a spinner.
 *
 * A stalled ramp is nearly always the anchor waiting on something specific —
 * most often a missing trustline, which it will sit on indefinitely. Showing
 * its own status and message turns a mystery into a one-click fix.
 */
export function RampStatus({
  stage,
  detail,
  address,
  onFixed,
}: {
  stage: RampStage | null;
  detail: RampDetail | null;
  address: string | null;
  onFixed?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!stage) return null;

  const blocked = detail?.needsTrustline ?? false;
  const slow = (detail?.elapsedSeconds ?? 0) > 45;

  return (
    <div
      role="status"
      className={`grid gap-2 rounded-[var(--radius)] p-3 text-xs ${
        blocked ? "border border-destructive/40 bg-destructive/10" : "bg-secondary"
      }`}
    >
      <p className={blocked ? "font-medium" : "text-muted-foreground"}>
        {detail ? (STATUS_COPY[detail.status] ?? STAGE_COPY[stage]) : STAGE_COPY[stage]}
        {detail && detail.elapsedSeconds > 5 && !blocked && (
          <span className="tnum text-muted-foreground"> · {detail.elapsedSeconds} sn</span>
        )}
      </p>

      {detail?.message && detail.message !== STATUS_COPY[detail.status] && (
        <p className="text-muted-foreground">Anchor: {detail.message}</p>
      )}

      {blocked && address && (
        <>
          <p className="text-muted-foreground">
            Trustline'ı açtığınız anda anchor beklemeyi bırakıp USDC'yi gönderir — işlem iptal
            olmadı.
          </p>
          <Button
            variant="ghost"
            loading={busy}
            className="justify-self-start"
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await addUsdcTrustline(address);
                onFixed?.();
              } catch (err) {
                if (!isUserRejection(err)) {
                  setError(err instanceof Error ? err.message : String(err));
                }
              } finally {
                setBusy(false);
              }
            }}
          >
            USDC trustline'ı şimdi aç
          </Button>
        </>
      )}

      {slow && !blocked && (
        <p className="text-muted-foreground">
          Bu biraz uzun sürüyor. Sayfayı kapatmayın; anchor işlemi arka planda devam ediyor.
        </p>
      )}

      {error && <p className="text-destructive">{error}</p>}
    </div>
  );
}
