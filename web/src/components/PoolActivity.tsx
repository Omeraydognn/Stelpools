import { config } from "../lib/config";
import { truncateAddress } from "../lib/format";
import { dateTime, usdc, useT, type Key } from "../lib/i18n";
import type { VaultEvent } from "../lib/history";
import { Card } from "./ui";

const SIGN: Record<VaultEvent["kind"], string> = {
  deposited: "+",
  withdrawn: "−",
  donated: "+",
  advanced: "−",
  repaid: "+",
  written_off: "−",
};

/**
 * What has actually happened to the pool, straight from its events.
 *
 * Every line is a transaction anyone can open on the explorer — the point of
 * showing it is that none of the numbers above have to be taken on trust.
 */
export function PoolActivity({ events }: { events: VaultEvent[] }) {
  const t = useT();
  const items = events.slice(0, 12);

  return (
    <Card className="grid gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium">{t("act.title")}</h3>
        <p className="text-xs text-muted-foreground">{t("act.source")}</p>
      </div>

      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("act.empty")}</p>
      ) : (
        <ul className="grid list-none gap-0 p-0">
          {items.map((e) => (
            <li
              key={`${e.txHash}-${e.kind}-${e.ledger}`}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border py-2 text-xs last:border-0"
            >
              <span className="min-w-28 font-medium">{t(`act.${e.kind}` as Key)}</span>
              <span className="tnum">
                {SIGN[e.kind]}
                {usdc(e.assets)} USDC
              </span>
              {e.fee > 0n && (
                <span className="tnum text-muted-foreground">
                  {t("act.fee", { amount: usdc(e.fee) })}
                </span>
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
                {dateTime(e.at)}
              </a>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
