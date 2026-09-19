import type { PricePoint, VaultHistory } from "../lib/history";
import { dateTime, num, t } from "../lib/i18n";

const WIDTH = 520;
const HEIGHT = 120;
const PADDING = 6;

/**
 * Share price over the vault's recent history.
 *
 * Drawn from the contract's own events rather than a price feed — the line
 * can only go up, and every step in it is a deposit, withdrawal or yield
 * distribution that actually happened.
 */
export function PriceChart({ history }: { history: VaultHistory }) {
  const points = history.points;
  if (points.length < 2) {
    return (
      <div className="grid h-[120px] place-items-center rounded-[var(--radius)] border border-dashed border-border">
        <p className="px-4 text-center text-xs text-muted-foreground">{t("chart.needMore")}</p>
      </div>
    );
  }

  const prices = points.map((p) => Number(p.sharePrice) / 1e7);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || max * 0.01 || 1;

  const x = (i: number) => PADDING + (i / (points.length - 1)) * (WIDTH - PADDING * 2);
  const y = (price: number) =>
    HEIGHT - PADDING - ((price - min) / span) * (HEIGHT - PADDING * 2);

  const line = points.map((_, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(prices[i]!)}`).join(" ");
  const area = `${line} L${x(points.length - 1)},${HEIGHT} L${x(0)},${HEIGHT} Z`;
  const label = (p: PricePoint) => dateTime(p.at);

  return (
    <figure className="grid gap-2">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-[120px] w-full"
        role="img"
        aria-label={t("chart.alt", {
          from: num(prices[0]!, 4),
          to: num(prices.at(-1)!, 4),
        })}
      >
        <path d={area} fill="var(--primary)" opacity="0.12" />
        <path
          d={line}
          fill="none"
          stroke="var(--primary)"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {points.map((p, i) => (
          <circle key={`${p.ledger}-${i}`} cx={x(i)} cy={y(prices[i]!)} r="2.5" fill="var(--primary)">
            <title>{`${label(p)} · ${num(prices[i]!, 6)} ${t("chart.perShare")} · ${p.event}`}</title>
          </circle>
        ))}
      </svg>
      <figcaption className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
        <span className="tnum">{label(points[0]!)}</span>
        <span>
          {t("chart.events", { n: points.length })}
          {history.windowHours !== null &&
            t("chart.window", {
              h: history.windowHours < 1 ? "<1" : Math.round(history.windowHours),
            })}
        </span>
        <span className="tnum">{label(points.at(-1)!)}</span>
      </figcaption>
    </figure>
  );
}
