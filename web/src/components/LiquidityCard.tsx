import { useEffect, useRef, useState } from "react";

import type { AccountState } from "../lib/account";
import {
  addLiquidity,
  quoteLiquidity,
  removeLiquidity,
  withTolerance,
  type PoolState,
  type Stage,
} from "../lib/amm";
import { config } from "../lib/config";
import { parseAmount } from "../lib/format";
import { num, pct, usdc as fmt, useT, type Key } from "../lib/i18n";
import { isUserRejection } from "../lib/wallet";
import { Button, ErrorState, Field } from "./ui";

/** Both sides must land within this of the ratio the pool had when we quoted. */
const RATIO_TOLERANCE_BPS = 100; // 1%

/**
 * Putting liquidity in, and taking it out.
 *
 * A deposit has to arrive at the pool's current ratio or it would move the
 * price, so only one side is typed and the contract's own quote decides the
 * other. What comes back out is always the ratio at that later moment, not
 * the one that went in — the difference is impermanent loss, and the panel
 * says so rather than letting it be a surprise.
 */
export function LiquidityCard({
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
  const [mode, setMode] = useState<"add" | "remove">("add");
  return (
    <div className="grid gap-4">
      <div role="tablist" aria-label={t("liq.group")} className="grid grid-cols-2 gap-1 rounded-[var(--radius)] bg-secondary p-1">
        {(
          [
            ["add", t("liq.add")],
            ["remove", t("liq.remove")],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={mode === key}
            onClick={() => setMode(key)}
            className={`min-h-10 rounded-[calc(var(--radius)-2px)] text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              mode === key ? "bg-card text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === "add" ? (
        <AddPanel address={address} account={account} pool={pool} onDone={onDone} />
      ) : (
        <RemovePanel address={address} pool={pool} onDone={onDone} />
      )}
    </div>
  );
}

function AddPanel({
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
  const empty = pool.totalShares <= 0n;
  const [usdcInput, setUsdcInput] = useState("");
  const [atryInput, setAtryInput] = useState("");
  const [stage, setStage] = useState<Stage | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);

  const usdcTyped = parseAmount(usdcInput);
  const atryTyped = parseAmount(atryInput);
  const amountA = usdcTyped > 0 ? BigInt(Math.round(usdcTyped * 1e7)) : 0n;
  const amountB = atryTyped > 0 ? BigInt(Math.round(atryTyped * 1e7)) : 0n;

  /**
   * On an existing pool the second field is not the user's to choose: the
   * ratio decides it, and the contract would only take the matching part
   * anyway. Showing the real number is kinder than taking a wrong one and
   * silently returning the remainder.
   */
  const latest = useRef(0);
  useEffect(() => {
    if (empty || amountA <= 0n) return;
    const ticket = ++latest.current;
    const viewer = address ?? config.usdcIssuer;
    const timer = setTimeout(() => {
      void quoteLiquidity(pool.tokenA, amountA, viewer)
        .then((b) => {
          if (ticket === latest.current) setAtryInput(num(Number(b) / 1e7, 2, 7));
        })
        .catch(() => undefined);
    }, 300);
    return () => clearTimeout(timer);
  }, [amountA, empty, pool.tokenA, address]);

  const shortUsdc = Boolean(account?.exists) && usdcTyped > (account?.usdc ?? 0);
  const shortAtry = Boolean(account?.exists) && atryTyped > (account?.atry ?? 0);
  const ready =
    Boolean(address) && amountA > 0n && amountB > 0n && !shortUsdc && !shortAtry && !stage;

  async function run() {
    if (!address) return;
    setError(null);
    setReceipt(null);
    try {
      // The ratio can move between quoting and landing; these floors let
      // the contract refuse rather than take a deal we did not agree to.
      const minA = empty ? 0n : withTolerance(amountA, RATIO_TOLERANCE_BPS);
      const minB = empty ? 0n : withTolerance(amountB, RATIO_TOLERANCE_BPS);
      const { usedA, usedB, shares } = await addLiquidity(
        address,
        amountA,
        amountB,
        minA,
        minB,
        setStage,
      );
      setReceipt(
        t("liq.added", {
          a: `${fmt(usedA)} USDC`,
          b: `${fmt(usedB)} ${config.atryCode}`,
          shares: fmt(shares, 4),
        }),
      );
      setUsdcInput("");
      setAtryInput("");
      onDone();
    } catch (err) {
      if (!isUserRejection(err)) setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setStage(null);
    }
  }

  return (
    <div className="grid gap-4">
      {empty && (
        <p className="rounded-[var(--radius)] bg-secondary p-3 text-xs">{t("liq.firstProvider")}</p>
      )}

      <Field
        label="USDC"
        value={usdcInput}
        onChange={(e) => setUsdcInput(e.target.value)}
        inputMode="decimal"
        autoComplete="off"
        placeholder="0"
        suffix="USDC"
        error={shortUsdc ? t("swap2.overBalance", { amount: num(account?.usdc ?? 0), code: "USDC" }) : null}
        {...(account?.exists && !shortUsdc
          ? { hint: t("swap2.balance", { amount: num(account.usdc), code: "USDC" }) }
          : {})}
      />
      <Field
        label={config.atryCode}
        value={atryInput}
        onChange={(e) => setAtryInput(e.target.value)}
        inputMode="decimal"
        autoComplete="off"
        placeholder="0"
        suffix={config.atryCode}
        readOnly={!empty}
        error={shortAtry ? t("swap2.overBalance", { amount: num(account?.atry ?? 0), code: config.atryCode }) : null}
        {...(empty
          ? { hint: t("liq.youSetThePrice") }
          : { hint: t("liq.ratioDecides") })}
      />

      {error && <ErrorState error={error} />}
      {receipt && <p className="rounded-[var(--radius)] bg-secondary p-3 text-xs">{receipt}</p>}

      <Button onClick={() => void run()} disabled={!ready} loading={Boolean(stage)}>
        {!address ? t("ui.connectFirst") : stage ? t(`stage.${stage}` as Key) : t("liq.addCta")}
      </Button>
      <p className="text-xs text-muted-foreground">{t("liq.note")}</p>
    </div>
  );
}

function RemovePanel({
  address,
  pool,
  onDone,
}: {
  address: string | null;
  pool: PoolState;
  onDone: () => void;
}) {
  const t = useT();
  const [input, setInput] = useState("");
  const [stage, setStage] = useState<Stage | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);

  const held = Number(pool.userShares) / 1e7;
  const typed = parseAmount(input);
  const shares = typed > 0 ? BigInt(Math.round(typed * 1e7)) : 0n;
  const tooMany = shares > pool.userShares;

  // The slice is proportional, so it is exact arithmetic rather than a quote.
  const outA = pool.totalShares > 0n ? (shares * pool.reserveA) / pool.totalShares : 0n;
  const outB = pool.totalShares > 0n ? (shares * pool.reserveB) / pool.totalShares : 0n;
  const ready = Boolean(address) && shares > 0n && !tooMany && !stage;

  async function run() {
    if (!address) return;
    setError(null);
    setReceipt(null);
    try {
      const { amountA, amountB } = await removeLiquidity(
        address,
        shares,
        withTolerance(outA, RATIO_TOLERANCE_BPS),
        withTolerance(outB, RATIO_TOLERANCE_BPS),
        setStage,
      );
      setReceipt(
        t("liq.removed", {
          a: `${fmt(amountA)} USDC`,
          b: `${fmt(amountB)} ${config.atryCode}`,
        }),
      );
      setInput("");
      onDone();
    } catch (err) {
      if (!isUserRejection(err)) setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setStage(null);
    }
  }

  if (pool.userShares <= 0n) {
    return (
      <p className="rounded-[var(--radius)] bg-secondary p-3 text-xs text-muted-foreground">
        {address ? t("liq.noPosition") : t("position.connect")}
      </p>
    );
  }

  return (
    <div className="grid gap-4">
      <Field
        label={t("liq.sharesToBurn")}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        inputMode="decimal"
        autoComplete="off"
        placeholder="0"
        suffix={pool.symbol}
        error={tooMany ? t("amm.23") : null}
        hint={t("liq.youHold", { amount: num(held, 4), symbol: pool.symbol })}
      />
      <button
        type="button"
        onClick={() => setInput(String(held))}
        className="justify-self-start rounded-[var(--radius)] px-2 py-1 text-xs font-medium text-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {t("ui.all")}
      </button>

      <div className="rounded-[var(--radius)] border border-border bg-card p-3 text-xs">
        <p className="mb-2 text-muted-foreground">{t("swap2.youReceive")}</p>
        <div className="flex justify-between">
          <span>USDC</span>
          <span className="tnum">{fmt(outA)}</span>
        </div>
        <div className="mt-1 flex justify-between">
          <span>{config.atryCode}</span>
          <span className="tnum">{fmt(outB)}</span>
        </div>
      </div>

      {error && <ErrorState error={error} />}
      {receipt && <p className="rounded-[var(--radius)] bg-secondary p-3 text-xs">{receipt}</p>}

      <Button onClick={() => void run()} disabled={!ready} loading={Boolean(stage)}>
        {!address ? t("ui.connectFirst") : stage ? t(`stage.${stage}` as Key) : t("liq.removeCta")}
      </Button>
      <p className="text-xs text-muted-foreground">{t("liq.impermanent", { fee: pct(pool.feeBps / 100) })}</p>
    </div>
  );
}
