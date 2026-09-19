import { useState } from "react";

import { advanceOf, repayAdvance } from "../lib/vault";
import { useAsync } from "../lib/useAsync";
import { isUserRejection } from "../lib/wallet";
import { Button, Card, ErrorState } from "./ui";

const tl = (n: number) =>
  n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * An open advance, and the one button that closes it.
 *
 * The vault paid this person before the anchor delivered. Nothing forces the
 * repayment on-chain, so the debt stays visible until they settle it — and
 * everyone can see it, because `advance_of` is a public view.
 */
export function AdvanceBanner({ address, onRepaid }: { address: string; onRepaid: () => void }) {
  const owed = useAsync(() => advanceOf(address, address), [address], 15_000);
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const amount = owed.data ?? 0n;
  if (amount <= 0n) return null;

  return (
    <Card className="grid gap-3 border-primary/40 bg-primary/5">
      <div>
        <p className="text-sm font-medium">Açık avansınız var</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Kasa, anchor'ın USDC'yi göndermesini beklemeden size{" "}
          <span className="tnum">{tl(Number(amount) / 1e7)}</span> USDC'lik bir borç açtı.
          Anchor'ın USDC'si cüzdanınıza düştüğünde bunu geri ödeyin — komisyon havuzda kalan
          herkese yazılır.
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
        {stage ? "İşleniyor…" : `${tl(Number(amount) / 1e7)} USDC öde ve kapat`}
      </Button>
    </Card>
  );
}
