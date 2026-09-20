import { useState } from "react";

import { loadAccount } from "../lib/account";
import { explorerContract, readPool } from "../lib/amm";
import { config } from "../lib/config";
import { truncateAddress } from "../lib/format";
import { num, pct, usdc as fmt, useT } from "../lib/i18n";
import { useAsync } from "../lib/useAsync";
import { AnchorActivity } from "./AnchorActivity";
import { LiquidityCard } from "./LiquidityCard";
import { RampCard } from "./RampCard";
import { SwapCard } from "./SwapCard";
import { Button, Card, ErrorState, Skeleton } from "./ui";

type Tab = "swap" | "liquidity" | "ramp";

/**
 * The pool, and the three things a person can do with it.
 *
 * Deliberately one screen: bringing lira in, trading it, and providing
 * liquidity are the same journey, and splitting them across pages hides
 * that the price on the swap tab is produced by the reserves on this one.
 */
export function PoolView({
  address,
  onConnect,
  connecting,
}: {
  address: string | null;
  onConnect: () => void;
  connecting: boolean;
}) {
  const t = useT();
  const [tab, setTab] = useState<Tab>("swap");

  // Reads are simulations and need a source account; without a wallet, any
  // funded account will do.
  const viewer = address ?? config.usdcIssuer;
  const pool = useAsync(() => readPool(viewer), [viewer], 15_000);
  const account = useAsync(
    () => (address ? loadAccount(address) : Promise.resolve(null)),
    [address],
  );

  const refresh = () => {
    pool.reload();
    account.reload();
  };

  if (pool.initial && pool.loading) {
    return (
      <div className="grid gap-4" aria-busy>
        <Skeleton className="h-20" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (pool.error) return <ErrorState error={pool.error} onRetry={pool.reload} />;
  if (!pool.data) return null;

  const p = pool.data;
  const priced = p.spotPrice > 0n;

  const stats: Array<[string, string]> = [
    [t("pool2.rate"), priced ? `${num(Number(p.spotPrice) / 1e7, 2)} ${config.atryCode}` : "—"],
    [t("pool2.usdcSide"), `${fmt(p.reserveA)} USDC`],
    [t("pool2.atrySide"), `${fmt(p.reserveB)} ${config.atryCode}`],
    [t("pool2.fee"), pct(p.feeBps / 100)],
    [t("pool2.lpTokens"), fmt(p.totalShares, 4)],
  ];

  return (
    <div className="grid gap-6">
      <div className="pool-header">
        <div>
          <h2>
            USDC / {config.atryCode}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("pool2.tagline")}{" "}
            <a
              href={explorerContract()}
              target="_blank"
              rel="noreferrer"
              className="text-primary underline underline-offset-4"
            >
              {t("pool.contract")}
            </a>
          </p>
        </div>
        <dl>
          {stats.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="tnum">{value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="vault-layout">
        <div className="grid gap-4">
          <Card className="grid gap-3">
            <h3 className="text-sm font-medium">{t("pool2.yourPosition")}</h3>
            {!address ? (
              <p className="text-sm text-muted-foreground">{t("position.connect")}</p>
            ) : p.userShares <= 0n ? (
              <p className="text-sm text-muted-foreground">{t("liq.noPosition")}</p>
            ) : (
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                {[
                  [t("pool2.lpHeld"), `${fmt(p.userShares, 4)} ${p.symbol}`],
                  [t("pool2.yourUsdc"), `${fmt(p.userA)} USDC`],
                  [t("pool2.yourAtry"), `${fmt(p.userB)} ${config.atryCode}`],
                  [
                    t("pool2.shareOfPool"),
                    p.totalShares > 0n
                      ? pct((Number(p.userShares) / Number(p.totalShares)) * 100)
                      : "—",
                  ],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-xs text-muted-foreground">{label}</dt>
                    <dd className="tnum text-base font-semibold">{value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </Card>

          <Card className="grid gap-3">
            <h3 className="text-sm font-medium">{t("pool2.walletTitle")}</h3>
            {account.data?.exists ? (
              <dl className="grid grid-cols-3 gap-4">
                {[
                  ["USDC", num(account.data.usdc)],
                  [config.atryCode, num(account.data.atry)],
                  ["XLM", num(account.data.xlm)],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-xs text-muted-foreground">{label}</dt>
                    <dd className="tnum text-base font-semibold">{value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">{t("position.connect")}</p>
            )}
          </Card>

          {address && <AnchorActivity address={address} />}

          <Card className="grid gap-2 text-xs text-muted-foreground">
            <h3 className="text-sm font-medium text-foreground">{t("how2.title")}</h3>
            <p>{t("how2.p1", { code: config.atryCode })}</p>
            <p>{t("how2.p2")}</p>
            <p>{t("how2.p3", { fee: pct(p.feeBps / 100) })}</p>
            <p>{t("how2.p4")}</p>
          </Card>

          <Card className="grid gap-3">
            <h3 className="text-sm font-medium">{t("pool2.contracts")}</h3>
            <dl className="grid gap-2 text-xs">
              {[
                [t("pool2.poolContract"), config.ammId],
                ["USDC", p.tokenA],
                [config.atryCode, p.tokenB],
                [t("pool2.atryIssuer"), config.atryIssuer],
              ].map(([label, id]) => (
                <div key={label} className="flex items-baseline justify-between gap-3">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd>
                    <a
                      href={`${config.explorer}/${id!.startsWith("C") ? "contract" : "account"}/${id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="tnum text-primary underline underline-offset-4"
                      title={id}
                    >
                      {truncateAddress(id!, 6)}
                    </a>
                  </dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>

        <Card className="trade-panel surface-card grid gap-4 self-start">
          <div
            role="tablist"
            aria-label={t("tab.group")}
            className="grid grid-cols-3 gap-1 rounded-[var(--radius)] bg-secondary p-1"
          >
            {(
              [
                ["swap", t("tab.swap")],
                ["liquidity", t("pool2.liquidity")],
                ["ramp", t("ramp2.group")],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={`min-h-10 rounded-[calc(var(--radius)-2px)] text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  tab === key
                    ? "bg-card text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {!address && (
            <div className="wallet-callout">
              <p>{t("position.connect")}</p>
              <Button loading={connecting} onClick={onConnect}>
                {t("wallet.connect")}
              </Button>
            </div>
          )}

          {tab === "swap" ? (
            <SwapCard
              address={address}
              account={account.data ?? null}
              pool={p}
              onDone={refresh}
            />
          ) : tab === "liquidity" ? (
            <LiquidityCard
              address={address}
              account={account.data ?? null}
              pool={p}
              onDone={refresh}
            />
          ) : (
            <RampCard address={address} account={account.data ?? null} onDone={refresh} />
          )}
        </Card>
      </div>
    </div>
  );
}
