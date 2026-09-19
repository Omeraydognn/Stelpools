import { config } from "../lib/config";
import { truncateAddress } from "../lib/format";
import type { VaultEvent } from "../lib/history";
import { Card } from "./ui";

const KIND_COPY: Record<VaultEvent["kind"], { label: string; sign: string }> = {
  deposited: { label: "Yatırma", sign: "+" },
  withdrawn: { label: "Çekme", sign: "−" },
  donated: { label: "Getiri dağıtımı", sign: "+" },
  advanced: { label: "Önden ödeme", sign: "−" },
  repaid: { label: "Avans geri ödeme", sign: "+" },
  written_off: { label: "Batık yazıldı", sign: "−" },
};

const usdc = (stroops: bigint) =>
  (Number(stroops) / 1e7).toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

/**
 * What has actually happened to the pool, straight from its events.
 *
 * Every line is a transaction anyone can open on the explorer — the point of
 * showing it is that none of the numbers above have to be taken on trust.
 */
export function PoolActivity({ events }: { events: VaultEvent[] }) {
  const items = events.slice(0, 12);

  return (
    <Card className="grid gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium">Havuz hareketleri</h3>
        <p className="text-xs text-muted-foreground">
          Kontratın event'lerinden · RPC penceresi kadar geriye
        </p>
      </div>

      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Bu pencerede hareket yok. İlk yatırma yapıldığında burada görünür.
        </p>
      ) : (
        <ul className="grid list-none gap-0 p-0">
          {items.map((e) => (
            <li
              key={`${e.txHash}-${e.kind}-${e.ledger}`}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border py-2 text-xs last:border-0"
            >
              <span className="min-w-28 font-medium">{KIND_COPY[e.kind].label}</span>
              <span className="tnum">
                {KIND_COPY[e.kind].sign}
                {usdc(e.assets)} USDC
              </span>
              {e.fee > 0n && (
                <span className="tnum text-muted-foreground">komisyon {usdc(e.fee)}</span>
              )}
              {e.account && (
                <span className="tnum text-muted-foreground">
                  {truncateAddress(e.account)}
                </span>
              )}
              <a
                href={`${config.explorer}/tx/${e.txHash}`}
                target="_blank"
                rel="noreferrer"
                className="tnum ml-auto text-muted-foreground underline underline-offset-4 hover:text-foreground"
              >
                {e.at.toLocaleString("tr-TR", {
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </a>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
