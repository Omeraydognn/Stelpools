import { useState } from "react";

import { usdc as fmtUsdc, useT } from "../lib/i18n";
import { advanceOf, repayAdvance } from "../lib/vault";
import { useAsync } from "../lib/useAsync";
import { isUserRejection } from "../lib/wallet";
import { Button, Card, ErrorState } from "./ui";

/**
 * An open advance, and the one button that closes it.
 *
 * The vault paid this person before the anchor delivered. Nothing forces the
 * repayment on-chain, so the debt stays visible until they settle it — and
 * everyone can see it, because `advance_of` is a public view.
 */
export function AdvanceBanner({ address, onRepaid }: { address: string; onRepaid: () => void }) {
  const t = useT();
  const owed = useAsync(() => advanceOf(address, address), [address], 15_000);
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const amount = owed.data ?? 0n;
  if (amount <= 0n) return null;

  return (
    <Card className="grid gap-3 border-primary/40 bg-primary/5">
      <div>
        <p className="text-sm font-medium">{t("advance.title")}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("advance.bodyPrefix")}
          <span className="tnum">{fmtUsdc(amount)}</span>
          {t("advance.bodySuffix")}
        </p>
      </div>
      {error && <ErrorState error={error} />}
      <Button
        className="justify-self-start"
        loading={Boolean(stage)}
        onClick={async () => {
          setError(null);
          try {
            await repayAdvance(address, address, amount, setStage);
            owed.reload();
            onRepaid();
          } catch (err) {
            if (!isUserRejection(err)) {
              setError(err instanceof Error ? err : new Error(String(err)));
            }
          } finally {
            setStage(null);
          }
        }}
      >
        {stage ? t("ui.processing") : t("advance.repay", { amount: fmtUsdc(amount) })}
      </Button>
    </Card>
  );
}
