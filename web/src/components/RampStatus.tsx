import { useState } from "react";

import { addUsdcTrustline } from "../lib/account";
import { dict, useT, type Key } from "../lib/i18n";
import type { RampDetail, RampStage } from "../lib/sep6";
import { isUserRejection } from "../lib/wallet";
import { Button } from "./ui";

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
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!stage) return null;

  // The anchor's own vocabulary, translated where we have a phrase for it.
  const statusKey = detail ? (`anchorStatus.${detail.status}` as Key) : null;
  const statusText = statusKey && statusKey in dict ? t(statusKey) : null;
  const stageText = t(`stage.${stage}` as Key);

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
        {statusText ?? stageText}
        {detail && detail.elapsedSeconds > 5 && !blocked && (
          <span className="tnum text-muted-foreground">
            {" · "}
            {t("ramp.seconds", { n: detail.elapsedSeconds })}
          </span>
        )}
      </p>

      {detail?.message && detail.message !== statusText && (
        <p className="text-muted-foreground">{t("ramp.anchorSays", { message: detail.message })}</p>
      )}

      {blocked && address && (
        <>
          <p className="text-muted-foreground">{t("ramp.trustlineFix")}</p>
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
            {t("ramp.openTrustlineNow")}
          </Button>
        </>
      )}

      {slow && !blocked && (
        <p className="text-muted-foreground">{t("ramp.slow")}</p>
      )}

      {error && <p className="text-destructive">{error}</p>}
    </div>
  );
}
