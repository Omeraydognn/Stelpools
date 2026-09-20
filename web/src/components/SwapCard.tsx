import { useEffect, useRef, useState } from "react";

import type { AccountState } from "../lib/account";
import { addBothTrustlines } from "../lib/account";
import {
  priceImpactBps,
  quoteSwap,
  swap,
  withTolerance,
  type PoolState,
  type Stage,
} from "../lib/amm";
import { config } from "../lib/config";
import { parseAmount } from "../lib/format";
import { num, pct, usdc as fmt, useT, type Key } from "../lib/i18n";
import { isUserRejection } from "../lib/wallet";
import { Amount, Button, ErrorState, Field } from "./ui";

/** Above this, the trade is costing far more than the fee and should say so. */
const IMPACT_WARN_BPS = 100; // 1%
const IMPACT_ALARM_BPS = 500; // 5%

const TOLERANCES = [50, 100, 300] as const; // 0.5%, 1%, 3%

type Direction = "atryToUsdc" | "usdcToAtry";

/**
 * A swap against the pool, signed by the user, settled on-chain.
 *
 * Nothing here asks a server what the price is. The quote comes from
 * simulating the contract, and the floor the user accepts is passed into
 * the call itself — between building a transaction and it landing, somebody
 * else's trade can move the reserves, and `min_out` is what makes that the
 * pool's problem to refuse rather than the user's to discover afterwards.
 */
export function SwapCard({
  address,
  account,
  pool,
  onDone,
}: {
  address: string | null;
  account: AccountState | null;
  pool: PoolState;
  onDone: () => void;
}) {
  const t = useT();
  const [direction, setDirection] = useState<Direction>("atryToUsdc");
  const [input, setInput] = useState("");
  const [tolerance, setTolerance] = useState<number>(100);

  const [quote, setQuote] = useState<bigint | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [stage, setStage] = useState<Stage | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [fixing, setFixing] = useState(false);

  const sellingAtry = direction === "atryToUsdc";
  const inCode = sellingAtry ? config.atryCode : "USDC";
  const outCode = sellingAtry ? "USDC" : config.atryCode;
  const tokenIn = sellingAtry ? pool.tokenB : pool.tokenA;
  const reserveIn = sellingAtry ? pool.reserveB : pool.reserveA;
  const reserveOut = sellingAtry ? pool.reserveA : pool.reserveB;

  const typed = parseAmount(input);
  const amountIn = typed > 0 ? BigInt(Math.round(typed * 1e7)) : 0n;
  const balance = account ? (sellingAtry ? account.atry : account.usdc) : 0;
  const overBalance = Boolean(account?.exists) && typed > balance;
  const poolEmpty = pool.reserveA <= 0n || pool.reserveB <= 0n;
  const needsTrustline =
    Boolean(account?.exists) && (!account?.hasUsdcTrustline || !account?.hasAtryTrustline);

  /**
   * Re-quote as the user types, but only after they pause.
   *
   * Each quote is a simulation against the live contract; firing one per
   * keystroke would be both slow and wrong, because the answer that arrives
   * last is not necessarily the answer to what is on screen now.
   */
  const latest = useRef(0);
  useEffect(() => {
    if (amountIn <= 0n || poolEmpty) {
      setQuote(null);
      return;
    }
    const ticket = ++latest.current;
    const viewer = address ?? config.usdcIssuer;
    setQuoting(true);
    const timer = setTimeout(() => {
      void quoteSwap(tokenIn, amountIn, viewer)
        .then((out) => {
          if (ticket === latest.current) setQuote(BigInt(out));
        })
        .catch(() => {
          if (ticket === latest.current) setQuote(null);
        })
        .finally(() => {
          if (ticket === latest.current) setQuoting(false);
        });
    }, 300);
    return () => clearTimeout(timer);
  }, [amountIn, tokenIn, poolEmpty, address]);

  const impact = quote ? priceImpactBps(amountIn, quote, reserveIn, reserveOut) : 0;
  const minOut = quote ? withTolerance(quote, tolerance) : 0n;
  const ready =
    Boolean(address) && amountIn > 0n && quote !== null && !overBalance && !needsTrustline && !stage;

  async function run() {
    if (!address || !quote) return;
    setError(null);
    setReceipt(null);
    try {
      const { amountOut } = await swap(address, tokenIn, amountIn, minOut, setStage);
      setReceipt(
        t("swap2.receipt", {
          paid: `${num(typed)} ${inCode}`,
          got: `${fmt(amountOut)} ${outCode}`,
        }),
      );
      setInput("");
      setQuote(null);
      onDone();
    } catch (err) {
      if (!isUserRejection(err)) setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setStage(null);
    }
  }

  return (
    <div className="grid gap-4">
      <Field
        label={t("swap2.youPay")}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        inputMode="decimal"
        autoComplete="off"
        placeholder="0"
        suffix={inCode}
        error={overBalance ? t("swap2.overBalance", { amount: num(balance), code: inCode }) : null}
        {...(account?.exists && !overBalance
          ? { hint: t("swap2.balance", { amount: num(balance), code: inCode }) }
          : {})}
      />
      {account?.exists && balance > 0 && (
        <button
          type="button"
          onClick={() => setInput(String(balance))}
          className="justify-self-start rounded-[var(--radius)] px-2 py-1 text-xs font-medium text-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t("ui.all")}
        </button>
      )}

      <button
        type="button"
        onClick={() => {
          setDirection(sellingAtry ? "usdcToAtry" : "atryToUsdc");
          setInput("");
          setQuote(null);
          setReceipt(null);
        }}
        aria-label={t("swap.flip")}
        className="mx-auto flex size-10 items-center justify-center rounded-full border border-border bg-card text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        ↓↑
      </button>

      <div className="rounded-[var(--radius)] border border-border bg-card p-3">
        <p className="mb-1 text-xs text-muted-foreground">{t("swap2.youReceive")}</p>
        <Amount value={quote ? fmt(quote) : "—"} unit={outCode} size="lg" />
        {quoting && <p className="mt-1 text-xs text-muted-foreground">{t("swap2.quoting")}</p>}

        {quote !== null && (
          <dl className="mt-3 grid gap-1.5 border-t border-border pt-3 text-xs">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{t("swap2.rate")}</dt>
              <dd className="tnum">
                1 {inCode} ≈ {num(Number(quote) / 1e7 / (typed || 1), 4)} {outCode}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{t("swap2.priceImpact")}</dt>
              <dd
                className={`tnum ${
                  impact >= IMPACT_ALARM_BPS
                    ? "text-destructive"
                    : impact >= IMPACT_WARN_BPS
                      ? "text-primary"
                      : ""
                }`}
              >
                {pct(impact / 100)}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{t("swap2.fee")}</dt>
              <dd className="tnum">{pct(pool.feeBps / 100)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{t("swap2.minReceived")}</dt>
              <dd className="tnum">
                {fmt(minOut)} {outCode}
              </dd>
            </div>
          </dl>
        )}
      </div>

      {quote !== null && impact >= IMPACT_WARN_BPS && (
        <p
          role="status"
          className={`rounded-[var(--radius)] p-3 text-xs ${
            impact >= IMPACT_ALARM_BPS
              ? "border border-destructive/40 bg-destructive/10"
              : "bg-secondary"
          }`}
        >
          {t("swap2.impact", { pct: pct(impact / 100) })}
        </p>
      )}

      <fieldset className="grid gap-2">
        <legend className="text-xs text-muted-foreground">{t("swap2.slippage")}</legend>
        <div className="flex gap-1 rounded-[var(--radius)] bg-secondary p-1">
          {TOLERANCES.map((bps) => (
            <button
              key={bps}
              type="button"
              onClick={() => setTolerance(bps)}
              aria-pressed={tolerance === bps}
              className={`min-h-10 flex-1 rounded-[calc(var(--radius)-2px)] text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                tolerance === bps
                  ? "bg-card text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {pct(bps / 100, bps % 100 === 0 ? 0 : 1)}
            </button>
          ))}
        </div>
      </fieldset>

      {poolEmpty && (
        <p className="rounded-[var(--radius)] border border-destructive/40 bg-destructive/10 p-3 text-xs">
          {t("swap2.emptyPool")}
        </p>
      )}

      {needsTrustline && address && (
        <div className="grid gap-2 rounded-[var(--radius)] border border-destructive/40 bg-destructive/10 p-3 text-xs">
          <p>{t("swap2.needTrustline")}</p>
          <Button
            variant="ghost"
            className="justify-self-start"
            loading={fixing}
            onClick={async () => {
              setFixing(true);
              setError(null);
              try {
                await addBothTrustlines(address);
                onDone();
              } catch (err) {
                if (!isUserRejection(err))
                  setError(err instanceof Error ? err : new Error(String(err)));
              } finally {
                setFixing(false);
              }
            }}
          >
            {t("swap2.addTrustlines")}
          </Button>
        </div>
      )}

      {error && <ErrorState error={error} />}
      {receipt && <p className="rounded-[var(--radius)] bg-secondary p-3 text-xs">{receipt}</p>}

      <Button onClick={() => void run()} disabled={!ready} loading={Boolean(stage)}>
        {!address
          ? t("ui.connectFirst")
          : stage
            ? t(`stage.${stage}` as Key)
            : t("swap2.cta", { from: inCode, to: outCode })}
      </Button>

      <p className="text-xs text-muted-foreground">{t("swap2.onchain")}</p>
    </div>
  );
}
