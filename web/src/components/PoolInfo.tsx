import { config } from "../lib/config";
import { truncateAddress } from "../lib/format";
import { num, pct, usdc as fmtUsdc, useT } from "../lib/i18n";
import type { VaultTotals } from "../lib/history";
import type { VaultState } from "../lib/vault";
import { Card } from "./ui";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border py-2 text-xs last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="tnum text-right">{children}</span>
    </div>
  );
}

function Explorer({ id, label }: { id: string; label?: string }) {
  if (!id) return <span className="text-muted-foreground">—</span>;
  const kind = id.startsWith("C") ? "contract" : "account";
  return (
    <a
      href={`${config.explorer}/${kind}/${id}`}
      target="_blank"
      rel="noreferrer"
      className="tnum text-primary underline underline-offset-4"
      title={id}
    >
      {label ?? truncateAddress(id, 5)}
    </a>
  );
}

/**
 * Everything a liquidity provider would want to check before committing,
 * laid out the way a pool page usually does it.
 *
 * Only real numbers appear here. An AMM's amplification factor or a staking
 * gauge have no meaning in a single-asset vault, so those rows say so rather
 * than inventing a value.
 */
export function PoolInfo({
  vault,
  rate,
  apr,
  totals,
  windowHours,
}: {
  vault: VaultState;
  /** TRY per USDC from the anchor. */
  rate: number | null;
  apr: number | null;
  totals: VaultTotals | null;
  windowHours: number | null;
}) {
  const t = useT();
  const windowLabel =
    windowHours === null
      ? t("pi.windowTracked")
      : t("pi.windowHours", { h: windowHours < 1 ? "<1" : Math.round(windowHours) });
  const total = Number(vault.totalAssets) / 1e7;
  const advanced = Number(vault.totalAdvanced) / 1e7;
  const liquid = Number(vault.liquidAssets) / 1e7;
  // What share of the pool is working rather than sitting idle.
  const utilization = total > 0 ? (advanced / total) * 100 : 0;

  return (
    <Card className="grid gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="text-xs text-muted-foreground">{t("pi.utilization")}</p>
          <p className="tnum text-2xl font-semibold tracking-tight">{pct(utilization)}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("pi.utilizationNote", {
              advanced: fmtUsdc(vault.totalAdvanced),
              liquid: fmtUsdc(vault.liquidAssets),
            })}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{t("pi.staked")}</p>
          <p className="text-2xl font-semibold tracking-tight text-muted-foreground">—</p>
          <p className="mt-1 text-xs text-muted-foreground">{t("pi.stakedNote")}</p>
        </div>
      </div>

      <section>
        <h4 className="mb-2 text-sm font-medium">{t("pi.composition")}</h4>
        <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 text-xs">
          <span className="text-muted-foreground">{t("pi.asset")}</span>
          <span className="text-right text-muted-foreground">{t("pi.ratio")}</span>
          <span className="text-right text-muted-foreground">{t("pi.amount")}</span>

          <span className="mt-1 flex items-baseline gap-2">
            USDC <Explorer id={vault.usdc} />
          </span>
          <span className="tnum mt-1 text-right">{pct(100, 0)}</span>
          <span className="tnum mt-1 text-right">{fmtUsdc(vault.totalAssets)}</span>

          <span className="pl-3 text-muted-foreground">{t("pi.onHand")}</span>
          <span className="tnum text-right text-muted-foreground">
            {pct(total > 0 ? (liquid / total) * 100 : 0)}
          </span>
          <span className="tnum text-right text-muted-foreground">
            {fmtUsdc(vault.liquidAssets)}
          </span>

          <span className="pl-3 text-muted-foreground">{t("pi.fronted")}</span>
          <span className="tnum text-right text-muted-foreground">{pct(utilization)}</span>
          <span className="tnum text-right text-muted-foreground">
            {fmtUsdc(vault.totalAdvanced)}
          </span>
        </div>
        <div className="mt-2 flex justify-between border-t border-border pt-2 text-xs">
          <span className="text-muted-foreground">{t("pi.total")}</span>
          <span className="tnum">
            {fmtUsdc(vault.totalAssets)} USDC
            {rate ? ` · ${num(total * rate)} TRY` : ""}
          </span>
        </div>
      </section>

      {totals && (
        <section>
          <h4 className="mb-2 text-sm font-medium">{t("pi.volumeEarnings")}</h4>
          <Row label={t("pi.volume", { window: windowLabel })}>
            {fmtUsdc(totals.volume)} USDC
          </Row>
          <Row label={t("pi.depWit")}>
            {fmtUsdc(totals.depositVolume)} / {fmtUsdc(totals.withdrawVolume)}
          </Row>
          <Row label={t("pi.withdrawFeesEarned")}>{fmtUsdc(totals.withdrawFees, 4)} USDC</Row>
          <Row label={t("pi.advanceFeesEarned")}>{fmtUsdc(totals.advanceFees, 4)} USDC</Row>
          <Row label={t("pi.advancesOpened")}>{totals.advancesOpened}</Row>
          {totals.writtenOff > 0n && (
            <Row label={t("pi.writtenOff")}>
              <span className="text-destructive">{fmtUsdc(totals.writtenOff)} USDC</span>
            </Row>
          )}
        </section>
      )}

      <section>
        <h4 className="mb-2 text-sm font-medium">{t("pi.yieldSources")}</h4>
        <Row label={t("pi.measuredApr")}>
          {apr === null ? (
            <span className="text-muted-foreground">{t("pi.notEnoughHistory")}</span>
          ) : (
            pct(apr)
          )}
        </Row>
        <Row label={t("pool.withdrawFee")}>{pct(vault.withdrawFeeBps / 100)}</Row>
        <Row label={t("pi.advanceFee")}>{pct(vault.advanceFeeBps / 100)}</Row>
        <Row label={t("pi.distribution")}>{t("pi.distributionValue")}</Row>
      </section>

      <section>
        <h4 className="mb-2 text-sm font-medium">{t("pi.contracts")}</h4>
        <Row label={t("pi.vaultShareToken")}>
          <Explorer id={config.vaultId} />
        </Row>
        <Row label={t("pi.usdcSac")}>
          <Explorer id={vault.usdc} />
        </Row>
        <Row label={t("pi.admin")}>
          <Explorer id={vault.admin} />
        </Row>
        <Row label={t("pi.relay")}>
          <Explorer id={vault.relay} />
        </Row>
        <Row label={t("pi.priceSource")}>{t("pi.priceSourceValue")}</Row>
        <Row label={t("pi.network")}>{t("pi.networkValue")}</Row>
      </section>

      <section>
        <h4 className="mb-2 text-sm font-medium">{t("pi.parameters")}</h4>
        <Row label={t("pi.poolType")}>{t("pi.poolTypeValue")}</Row>
        <Row label={t("pi.shareToken")}>
          {vault.symbol} · SEP-41 · {t("pi.decimals")}
        </Row>
        <Row label={t("pool.sharePrice")}>{fmtUsdc(vault.sharePrice, 7)} USDC</Row>
        <Row label={t("pi.circulating")}>{fmtUsdc(vault.totalShares, 4)}</Row>
        <Row label={t("pi.depositCap")}>
          {vault.depositCapRaw > 0n ? `${fmtUsdc(vault.depositCapRaw)} USDC` : t("pi.unlimited")}
        </Row>
        <Row label={t("pi.maxAdvance")}>
          {vault.maxAdvance > 0n ? `${fmtUsdc(vault.maxAdvance)} USDC` : t("pi.off")}
        </Row>
        <Row label={t("pi.advanceCap")}>
          {vault.advanceCap > 0n ? `${fmtUsdc(vault.advanceCap)} USDC` : t("pi.off")}
        </Row>
        <Row label={t("pi.deposits")}>{vault.paused ? t("pi.paused") : t("pi.open")}</Row>
        <Row label={t("pi.withdrawals")}>{t("pi.alwaysOpen")}</Row>
      </section>

      <section>
        <h4 className="mb-2 text-sm font-medium">{t("pi.risks")}</h4>
        <ul className="grid list-disc gap-1.5 pl-4 text-xs text-muted-foreground">
          {(
            [
              ["pi.risk1Head", "pi.risk1Body"],
              ["pi.risk2Head", "pi.risk2Body"],
              ["pi.risk3Head", "pi.risk3Body"],
              ["pi.risk4Head", "pi.risk4Body"],
              ["pi.risk5Head", "pi.risk5Body"],
              ["pi.risk6Head", "pi.risk6Body"],
            ] as const
          ).map(([head, body]) => (
            <li key={head}>
              <span className="text-foreground">{t(head)}</span>
              {t(body)}
            </li>
          ))}
        </ul>
      </section>
    </Card>
  );
}
