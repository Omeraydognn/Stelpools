import { useState } from "react";

import { loadAccount, type AccountState } from "../lib/account";
import { indicativePrice } from "../lib/anchor";
import { config } from "../lib/config";
import {
  defaultTryAmount,
  formatUsdc,
  ibanProblem,
  isValidIban,
  normalizeIban,
  parseAmount,
  parseUsdcToStroops,
} from "../lib/format";
import { num, pct, t, usdc as fmtUsdc, useT, type Key } from "../lib/i18n";
import { positionFor, readHistory } from "../lib/history";
import { depositTry, withdrawToIban, type RampDetail, type RampStage } from "../lib/sep6";
import { deposit, explorerContract, explorerTx, readVault, withdraw } from "../lib/vault";
import { useAsync } from "../lib/useAsync";
import { isUserRejection } from "../lib/wallet";
import { AdvanceBanner } from "./AdvanceBanner";
import { AnchorActivity } from "./AnchorActivity";
import { PoolActivity } from "./PoolActivity";
import { PoolInfo } from "./PoolInfo";
import { PriceChart } from "./PriceChart";
import { RampStatus } from "./RampStatus";
import { SwapPanel } from "./SwapPanel";
import { BlockerList, blockersForProvide } from "./Requirements";
import { Amount, Button, Card, ErrorState, Field, Skeleton } from "./ui";

/** Every transaction stage the two panels can be in. */
const STAGE_KEYS = new Set([
  "building",
  "signing",
  "submitting",
  "confirming",
  "authenticating",
  "registering",
  "requesting",
  "transferring",
  "waiting",
  "done",
]);

function stageText(stage: string): string {
  return STAGE_KEYS.has(stage) ? t(`stage.${stage}` as Key) : stage;
}

/** The numbers across the top, the way a pool page always opens. */
function PoolHeader({
  tvlUsdc,
  sharePrice,
  feeBps,
  rate,
  apr,
  advanced,
}: {
  tvlUsdc: bigint;
  sharePrice: bigint;
  feeBps: number;
  rate: number | null;
  apr: number | null;
  advanced: bigint;
}) {
  const tt = useT();
  const tvl = Number(tvlUsdc) / 1e7;
  const stats: Array<[string, string]> = [
    [tt("pool.tvl"), `${num(tvl)} USDC`],
    [tt("pool.tvlTry"), rate ? `${num(tvl * rate)} TRY` : "—"],
    [tt("pool.sharePrice"), `${num(Number(sharePrice) / 1e7, 0, 6)} USDC`],
    [tt("pool.withdrawFee"), pct(feeBps / 100)],
    [tt("pool.apr"), apr === null ? "—" : pct(apr)],
    ...(advanced > 0n
      ? ([[tt("pool.advanced"), `${fmtUsdc(advanced)} USDC`]] as Array<[string, string]>)
      : []),
  ];
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-4">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">{tt("pool.pair")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {tt("pool.tagline")}{" "}
          <a
            href={explorerContract()}
            target="_blank"
            rel="noreferrer"
            className="text-primary underline underline-offset-4"
          >
            {tt("pool.contract")}
          </a>
        </p>
      </div>
      <dl className="flex flex-wrap gap-6">
        {stats.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="tnum text-base font-semibold">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function StageNote({ stage }: { stage: string | null }) {
  if (!stage) return null;
  return (
    <p role="status" className="text-xs text-muted-foreground">
      {stageText(stage)}
    </p>
  );
}

/** TRY → anchor → USDC → vault, or straight from a USDC balance. */
function DepositPanel({
  address,
  account,
  rate,
  onDone,
}: {
  address: string | null;
  account: AccountState | null;
  rate: number | null;
  onDone: () => void;
}) {
  const t = useT();
  const usdcBalance = account?.usdc ?? 0;
  // The anchor cannot deliver USDC to an account without a trustline; the
  // deposit would sit in `pending_trust` indefinitely.
  const needsTrustline = Boolean(account?.exists) && !account?.hasUsdcTrustline;
  const [mode, setMode] = useState<"try" | "usdc">("try");
  const [tryAmount, setTryAmount] = useState(defaultTryAmount);
  const [usdcAmount, setUsdcAmount] = useState("10");
  const [stage, setStage] = useState<string | null>(null);
  const [rampDetail, setRampDetail] = useState<RampDetail | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);

  const tryValue = parseAmount(tryAmount);
  const usdcStroops = parseUsdcToStroops(usdcAmount);
  const estimatedUsdc = rate && tryValue ? tryValue / rate : null;

  async function run(fn: () => Promise<string>) {
    setError(null);
    setReceipt(null);
    try {
      setReceipt(await fn());
      onDone();
    } catch (err) {
      if (!isUserRejection(err)) {
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      setStage(null);
      setRampDetail(null);
    }
  }

  return (
    <div className="grid gap-4">
      <div role="tablist" aria-label={t("dep.method")} className="grid grid-cols-2 gap-1 rounded-[var(--radius)] bg-secondary p-1">
        {(
          [
            ["try", t("dep.withTry")],
            ["usdc", t("dep.withUsdc")],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={mode === key}
            onClick={() => setMode(key)}
            className={`min-h-10 rounded-[calc(var(--radius)-2px)] text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
              mode === key ? "bg-card text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === "try" ? (
        <>
          <Field
            label={t("dep.amount")}
            value={tryAmount}
            onChange={(e) => setTryAmount(e.target.value)}
            inputMode="decimal"
            autoComplete="off"
            suffix="TRY"
            hint={t("dep.tryHint")}
          />
          <div className="rounded-[var(--radius)] border border-border bg-card p-3">
            <p className="mb-1 text-xs text-muted-foreground">{t("dep.estimate")}</p>
            <Amount
              value={estimatedUsdc ? num(estimatedUsdc) : "—"}
              unit="USDC"
              size="lg"
            />
            <p className="mt-2 text-xs text-muted-foreground">
              {t("dep.rateNote", { rate: rate ? num(rate) : "—" })}
            </p>
          </div>
          <ol className="grid gap-1 rounded-[var(--radius)] bg-secondary p-3 text-xs text-muted-foreground">
            <li>{t("dep.step1")}</li>
            <li>{t("dep.step2")}</li>
          </ol>
        </>
      ) : (
        <>
          <Field
            label={t("dep.amount")}
            value={usdcAmount}
            onChange={(e) => setUsdcAmount(e.target.value)}
            inputMode="decimal"
            autoComplete="off"
            suffix="USDC"
            hint={t("swap.youHaveUsdc", { amount: num(usdcBalance) })}
          />
          <button
            type="button"
            onClick={() => setUsdcAmount(String(usdcBalance))}
            className="justify-self-start rounded-[var(--radius)] px-2 py-1 text-xs font-medium text-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t("ui.all")}
          </button>
        </>
      )}

      {mode === "try" && needsTrustline && (
        <p className="rounded-[var(--radius)] border border-destructive/40 bg-destructive/10 p-3 text-xs">
          {t("dep.needTrustline")}
        </p>
      )}

      {error && <ErrorState error={error} />}
      {receipt && (
        <p className="rounded-[var(--radius)] bg-secondary p-3 text-xs">
          {receipt}
        </p>
      )}
      {stage && rampDetail ? (
        <RampStatus
          stage={stage as RampStage}
          detail={rampDetail}
          address={address}
          onFixed={onDone}
        />
      ) : (
        <StageNote stage={stage} />
      )}

      <Button
        disabled={!address || Boolean(stage) || (mode === "try" && needsTrustline)}
        loading={Boolean(stage)}
        onClick={() =>
          void run(async () => {
            if (!address) throw new Error(t("wallet.notConnected"));
            if (mode === "try") {
              const { usdc } = await depositTry(
                address,
                String(Math.round(tryValue)),
                (s: RampStage, d?: RampDetail) => {
                  setStage(s);
                  setRampDetail(d ?? null);
                },
              );
              const assets = parseUsdcToStroops(usdc);
              if (!assets) throw new Error(t("dep.badAnchorAmount"));
              const { shares } = await deposit(address, assets, setStage);
              return t("dep.receiptTry", {
                assets: formatUsdc(assets),
                shares: formatUsdc(shares),
              });
            }
            if (!usdcStroops) throw new Error(t("dep.badUsdcAmount"));
            const { shares, hash } = await deposit(address, usdcStroops, setStage);
            return t("dep.receiptUsdc", { shares: formatUsdc(shares), hash: hash.slice(0, 10) });
          })
        }
      >
        {!address
          ? t("ui.connectFirst")
          : stage
            ? stageText(stage)
            : mode === "try"
              ? t("dep.depositTryCta")
              : t("dep.depositUsdcCta")}
      </Button>
    </div>
  );
}

/** Vault → USDC in the wallet, then optionally on to a bank account. */
function WithdrawPanel({
  address,
  userShares,
  userAssets,
  feeBps,
  rate,
  symbol,
  onDone,
}: {
  address: string | null;
  userShares: bigint;
  userAssets: bigint;
  feeBps: number;
  rate: number | null;
  symbol: string;
  onDone: () => void;
}) {
  const t = useT();
  const [shares, setShares] = useState("");
  const [toBank, setToBank] = useState(false);
  const [iban, setIban] = useState("");
  const [bank, setBank] = useState("");
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);

  const sharesStroops = parseUsdcToStroops(shares);
  const held = Number(userShares) / 1e7;
  const fraction = sharesStroops && userShares > 0n ? Number(sharesStroops) / Number(userShares) : 0;
  const estimated = (Number(userAssets) / 1e7) * fraction;
  const ibanError = toBank ? ibanProblem(iban) : null;

  return (
    <div className="grid gap-4">
      <Field
        label={t("wd.shares")}
        value={shares}
        onChange={(e) => setShares(e.target.value)}
        inputMode="decimal"
        autoComplete="off"
        suffix={symbol}
        placeholder="0"
        hint={t("wd.hint", {
          shares: num(held),
          symbol,
          value: fmtUsdc(userAssets),
        })}
      />
      <button
        type="button"
        onClick={() => setShares(String(held))}
        className="justify-self-start rounded-[var(--radius)] px-2 py-1 text-xs font-medium text-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {t("ui.all")}
      </button>

      <div className="rounded-[var(--radius)] border border-border bg-card p-3">
        <p className="mb-1 text-xs text-muted-foreground">{t("swap.youGet")}</p>
        <Amount value={estimated ? num(estimated) : "—"} unit="USDC" size="lg" />
        <p className="mt-2 text-xs text-muted-foreground">
          {t("wd.feeNote", { fee: pct(feeBps / 100) })}
          {rate && estimated ? ` ≈ ${num(estimated * rate)} TRY` : ""}
        </p>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={toBank}
          onChange={(e) => setToBank(e.target.checked)}
          className="size-4 accent-[var(--primary)]"
        />
        {t("wd.toBank")}
      </label>

      {toBank && (
        <div className="grid gap-3">
          <Field
            label="IBAN"
            value={iban}
            onChange={(e) => setIban(e.target.value)}
            placeholder="TR00 0000 0000 0000 0000 0000 00"
            autoComplete="off"
            spellCheck={false}
            error={ibanError}
          />
          <Field
            label={t("swap.bankLabel")}
            value={bank}
            onChange={(e) => setBank(e.target.value)}
            autoComplete="off"
            placeholder={t("swap.bankPlaceholder")}
          />
          <p className="rounded-[var(--radius)] bg-secondary p-3 text-xs text-muted-foreground">
            {t("wd.bankNote")}
          </p>
        </div>
      )}

      {error && <ErrorState error={error} />}
      {receipt && <p className="rounded-[var(--radius)] bg-secondary p-3 text-xs">{receipt}</p>}
      <StageNote stage={stage} />

      <Button
        disabled={!address || !sharesStroops || userShares === 0n || Boolean(stage) || Boolean(ibanError)}
        loading={Boolean(stage)}
        onClick={async () => {
          if (!address || !sharesStroops) return;
          setError(null);
          setReceipt(null);
          try {
            const { assets, hash } = await withdraw(address, sharesStroops, setStage);
            let note = t("wd.receipt", { amount: formatUsdc(assets), hash: hash.slice(0, 10) });
            if (toBank && isValidIban(iban)) {
              const out = await withdrawToIban(
                address,
                (Number(assets) / 1e7).toFixed(7),
                normalizeIban(iban),
                bank,
                (s: RampStage) => setStage(s),
              );
              note += t("wd.receiptBank", { amount: num(Number(out.try)) });
            }
            setReceipt(note);
            setShares("");
            onDone();
          } catch (err) {
            if (!isUserRejection(err)) {
              setError(err instanceof Error ? err : new Error(String(err)));
            }
          } finally {
            setStage(null);
          }
        }}
      >
        {!address
          ? t("ui.connectFirst")
          : stage
            ? stageText(stage)
            : toBank
              ? t("wd.ctaBank")
              : t("wd.cta")}
      </Button>
    </div>
  );
}

export function VaultView({ address }: { address: string | null }) {
  const t = useT();
  const [tab, setTab] = useState<"swap" | "deposit" | "withdraw">("swap");

  // Reads need a source account for simulation; fall back to the vault admin
  // view by using the connected wallet when there is one.
  const viewer = address ?? config.usdcIssuer;
  const vault = useAsync(() => readVault(viewer), [viewer], 15_000);
  const account = useAsync(
    () => (address ? loadAccount(address) : Promise.resolve(null)),
    [address],
  );
  const price = useAsync(() => indicativePrice("1"), [], 60_000);
  const history = useAsync(() => readHistory(), [], 60_000);
  const rate = price.data ? Number(price.data.total_price) : null;

  const refresh = () => {
    vault.reload();
    account.reload();
    history.reload();
  };

  if (vault.initial && vault.loading) {
    return (
      <div className="grid gap-4" aria-busy>
        <Skeleton className="h-20" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (vault.error) return <ErrorState error={vault.error} onRetry={vault.reload} />;
  if (!vault.data) return null;

  const {
    totalAssets,
    sharePrice,
    withdrawFeeBps,
    depositCap,
    symbol,
    userShares,
    userAssets,
    paused,
  } = vault.data;
  const blockers = blockersForProvide(account.data ?? null, 0);

  // Cost basis from this account's own events. The RPC only serves recent
  // ledgers, so an older deposit is invisible — `observed` gates the display
  // rather than showing a number built on half the history.
  const position = address && history.data ? positionFor(history.data.events, address) : null;
  const pnl = position?.observed
    ? {
        netContributed: position.netContributed,
        gain: Number(userAssets - position.netContributed),
      }
    : null;

  return (
    <div className="grid gap-6">
      <PoolHeader
        tvlUsdc={totalAssets}
        sharePrice={sharePrice}
        feeBps={withdrawFeeBps}
        rate={rate}
        apr={history.data?.aprPercent ?? null}
        advanced={vault.data.totalAdvanced}
      />

      {address && <AdvanceBanner address={address} onRepaid={refresh} />}

      <div className="grid gap-4 lg:grid-cols-[1fr_minmax(0,380px)]">
        <div className="grid gap-4">
          <Card className="grid gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-medium">{t("chart.title")}</h3>
              <p className="text-xs text-muted-foreground">{t("chart.source")}</p>
            </div>
            {history.initial && history.loading ? (
              <Skeleton className="h-[120px]" />
            ) : history.data ? (
              <PriceChart history={history.data} />
            ) : null}
          </Card>

          <Card className="grid gap-3">
            <h3 className="text-sm font-medium">{t("position.title")}</h3>
            {!address ? (
              <p className="text-sm text-muted-foreground">{t("position.connect")}</p>
            ) : userShares === 0n ? (
              <p className="text-sm text-muted-foreground">{t("position.empty")}</p>
            ) : (
              <>
                <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                  {[
                    [t("position.shares"), `${fmtUsdc(userShares)} ${symbol}`],
                    [t("position.value"), `${fmtUsdc(userAssets)} USDC`],
                    [
                      t("position.inTry"),
                      rate ? `${num((Number(userAssets) / 1e7) * rate)} TRY` : "—",
                    ],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-xs text-muted-foreground">{label}</dt>
                      <dd className="tnum text-base font-semibold">{value}</dd>
                    </div>
                  ))}
                </dl>
                {pnl && (
                  <p className="text-xs text-muted-foreground">
                    {t("position.pnlPrefix")}
                    <span className="tnum">{fmtUsdc(pnl.netContributed)}</span>
                    {t("position.pnlMid")}
                    <span className="tnum">{fmtUsdc(userAssets)}</span>
                    {t("position.pnlSuffix")}
                    <span className={pnl.gain >= 0 ? "text-primary" : "text-destructive"}>
                      {pnl.gain >= 0 ? "+" : "−"}
                      <span className="tnum">{fmtUsdc(Math.abs(pnl.gain))}</span> USDC
                    </span>
                    {t("position.pnlTail")}
                  </p>
                )}
              </>
            )}
          </Card>

          {address && <AnchorActivity address={address} />}

          <PoolInfo
            vault={vault.data}
            rate={rate}
            apr={history.data?.aprPercent ?? null}
            totals={history.data?.totals ?? null}
            windowHours={history.data?.windowHours ?? null}
          />

          {history.data && <PoolActivity events={history.data.events} />}

          <Card className="grid gap-2 text-xs text-muted-foreground">
            <h3 className="text-sm font-medium text-foreground">{t("how.title")}</h3>
            <p>{t("how.p1")}</p>
            <p>{t("how.p2")}</p>
            <p>
              {t("how.p3Prefix")}
              <span className="tnum text-foreground">{symbol}</span>
              {t("how.p3Suffix")}
            </p>
            <p>
              {t("how.p4")}
              {depositCap > 0n && t("how.depositCap", { amount: fmtUsdc(depositCap) })}
            </p>
          </Card>
        </div>

        <Card className="grid gap-4 self-start">
          <div role="tablist" aria-label={t("tab.group")} className="grid grid-cols-3 gap-1 rounded-[var(--radius)] bg-secondary p-1">
            {(
              [
                ["swap", t("tab.swap")],
                ["deposit", t("tab.deposit")],
                ["withdraw", t("tab.withdraw")],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={`min-h-10 rounded-[calc(var(--radius)-2px)] text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                  tab === key
                    ? "bg-card text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {paused && tab === "deposit" && (
            <p className="rounded-[var(--radius)] border border-destructive/40 bg-destructive/10 p-3 text-xs">
              {t("tab.pausedNote")}
            </p>
          )}

          {address && <BlockerList blockers={blockers} address={address} onFixed={refresh} />}

          {tab === "swap" ? (
            <SwapPanel
              address={address}
              account={account.data ?? null}
              rate={rate}
              onDone={refresh}
            />
          ) : tab === "deposit" ? (
            <DepositPanel
              address={address}
              account={account.data ?? null}
              rate={rate}
              onDone={refresh}
            />
          ) : (
            <WithdrawPanel
              address={address}
              userShares={userShares}
              userAssets={userAssets}
              feeBps={withdrawFeeBps}
              rate={rate}
              symbol={symbol}
              onDone={refresh}
            />
          )}
        </Card>
      </div>
    </div>
  );
}

void explorerTx;
