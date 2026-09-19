import { useState } from "react";

import type { AccountState } from "../lib/account";
import {
  defaultTryAmount,
  ibanProblem,
  isValidIban,
  normalizeIban,
  parseAmount,
  parseUsdcToStroops,
} from "../lib/format";
import { num, useT, type Key } from "../lib/i18n";
import { relayEnabled, requestAdvance } from "../lib/relay";
import {
  awaitDeposit,
  openDeposit,
  simulateBankTransfer,
  withdrawToIban,
  type DepositInstructions,
  type RampDetail,
  type RampStage,
} from "../lib/sep6";
import { isUserRejection } from "../lib/wallet";
import { DepositInstructionsCard } from "./DepositInstructionsCard";
import { RampStatus } from "./RampStatus";
import { Amount, Button, ErrorState, Field } from "./ui";

/** The stage wording on the action button, which is terser than the panel's. */
const BUTTON_STAGE: Record<RampStage, Key> = {
  authenticating: "stage.authenticating",
  registering: "stage.registering",
  requesting: "stage.requestingInstructions",
  transferring: "stage.reportingTransfer",
  waiting: "stage.waiting",
  done: "stage.done",
};

const MIN_TRY = 50;
const MAX_TRY = 3000;

interface PendingDeposit {
  jwt: string;
  id: string;
  instructions: DepositInstructions;
}

/**
 * TRY ⇄ USDC over the anchor's rails.
 *
 * The counterparty for lira is always the anchor — no contract can hold a
 * bank balance, so the vault cannot be on the other side of this trade. What
 * the vault can do is front the USDC while the anchor settles, which is what
 * "get it instantly" does.
 */
export function SwapPanel({
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
  const [direction, setDirection] = useState<"tryToUsdc" | "usdcToTry">("tryToUsdc");
  const [tryAmount, setTryAmount] = useState(defaultTryAmount);
  const [usdcAmount, setUsdcAmount] = useState("10");
  const [iban, setIban] = useState("");
  const [bank, setBank] = useState("");
  const [instant, setInstant] = useState(relayEnabled());

  const [pending, setPending] = useState<PendingDeposit | null>(null);
  const [simulating, setSimulating] = useState(false);
  const [simulated, setSimulated] = useState(false);

  const [stage, setStage] = useState<RampStage | null>(null);
  const [detail, setDetail] = useState<RampDetail | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);

  const outTry = direction === "tryToUsdc";
  const tryValue = parseAmount(tryAmount);
  const usdcStroops = parseUsdcToStroops(usdcAmount);
  const usdcValue = usdcStroops ? Number(usdcStroops) / 1e7 : 0;
  const estimate = rate ? (outTry ? tryValue / rate : usdcValue * rate) : null;

  const tryOutOfRange = outTry && tryValue > 0 && (tryValue < MIN_TRY || tryValue > MAX_TRY);
  const notEnoughUsdc = !outTry && account ? usdcValue > account.usdc : false;
  const ibanError = !outTry ? ibanProblem(iban) : null;
  // Without a trustline the anchor cannot deliver and the deposit sits in
  // `pending_trust` indefinitely, so this is a hard requirement.
  const needsTrustline = Boolean(account?.exists) && !account?.hasUsdcTrustline;

  const ready =
    Boolean(address) &&
    !needsTrustline &&
    !stage &&
    (outTry
      ? tryValue > 0 && !tryOutOfRange
      : Boolean(usdcStroops) && !notEnoughUsdc && isValidIban(iban));

  function reset() {
    setPending(null);
    setSimulated(false);
    setDetail(null);
    setStage(null);
  }

  function fail(err: unknown) {
    if (!isUserRejection(err)) {
      setError(err instanceof Error ? err : new Error(String(err)));
    }
  }

  /** Step one: ask the anchor where to send the lira. */
  async function getInstructions() {
    if (!address || !ready) return;
    setError(null);
    setReceipt(null);
    try {
      const opened = await openDeposit(address, String(Math.round(tryValue)), (s, d) => {
        setStage(s);
        setDetail(d ?? null);
      });
      setPending(opened);
      setSimulated(false);
    } catch (err) {
      fail(err);
    } finally {
      setStage(null);
    }
  }

  /**
   * Step two: the lira has been sent. In the sandbox this also records the
   * transfer; against a live anchor the user has already made it.
   */
  async function confirmTransfer() {
    if (!pending) return;
    setSimulating(true);
    setError(null);
    try {
      await simulateBankTransfer(pending.jwt, pending.id);
      setSimulated(true);

      if (instant && relayEnabled()) {
        // The anchor is on the hook now, so the pool can pay immediately.
        const advance = await requestAdvance(pending.jwt, pending.id);
        setReceipt(
          t("swap.receiptAdvance", {
            paid: num(Number(advance.paid_out_usdc)),
            owed: num(Number(advance.owed_usdc)),
          }),
        );
        void awaitDeposit(pending.jwt, pending.id).then(onDone).catch(() => undefined);
        reset();
        return;
      }

      const { usdc } = await awaitDeposit(pending.jwt, pending.id, (s, d) => {
        setStage(s);
        setDetail(d ?? null);
      });
      setReceipt(t("swap.receiptDeposit", { amount: num(Number(usdc)) }));
      reset();
      onDone();
    } catch (err) {
      fail(err);
    } finally {
      setSimulating(false);
      setStage(null);
    }
  }

  async function cashOut() {
    if (!address || !ready) return;
    setError(null);
    setReceipt(null);
    try {
      const out = await withdrawToIban(
        address,
        usdcValue.toFixed(7),
        normalizeIban(iban),
        bank,
        (s, d) => {
          setStage(s);
          setDetail(d ?? null);
        },
      );
      setReceipt(t("swap.receiptCashOut", { amount: num(Number(out.try)) }));
      onDone();
    } catch (err) {
      fail(err);
    } finally {
      setStage(null);
      setDetail(null);
    }
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Field
          label={outTry ? t("swap.youPay") : t("swap.youSell")}
          value={outTry ? tryAmount : usdcAmount}
          onChange={(e) => (outTry ? setTryAmount(e.target.value) : setUsdcAmount(e.target.value))}
          inputMode="decimal"
          autoComplete="off"
          disabled={Boolean(pending)}
          suffix={outTry ? "TRY" : "USDC"}
          error={
            tryOutOfRange
              ? t("swap.limits", { min: num(MIN_TRY, 0), max: num(MAX_TRY, 0) })
              : notEnoughUsdc
                ? t("swap.youHaveUsdc", { amount: num(account?.usdc ?? 0) })
                : null
          }
          {...(!outTry && account?.exists
            ? { hint: t("swap.youHaveUsdc", { amount: num(account.usdc) }) }
            : {})}
        />

        <button
          type="button"
          onClick={() => {
            reset();
            setDirection(outTry ? "usdcToTry" : "tryToUsdc");
          }}
          aria-label={t("swap.flip")}
          className="mx-auto flex size-10 items-center justify-center rounded-full border border-border bg-card text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          ↓↑
        </button>

        <div className="rounded-[var(--radius)] border border-border bg-card p-3">
          <p className="mb-1 text-xs text-muted-foreground">{t("swap.youGet")}</p>
          <Amount value={estimate ? num(estimate) : "—"} unit={outTry ? "USDC" : "TRY"} size="lg" />
          <p className="mt-2 text-xs text-muted-foreground">
            {t("swap.rateNote", { rate: rate ? num(rate) : "—" })}
          </p>
        </div>
      </div>

      {!outTry && (
        <div className="grid gap-3">
          <Field
            label={t("swap.ibanLabel")}
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
        </div>
      )}

      {outTry && relayEnabled() && !pending && (
        <label className="flex items-start gap-2 rounded-[var(--radius)] border border-border p-3 text-xs">
          <input
            type="checkbox"
            checked={instant}
            onChange={(e) => setInstant(e.target.checked)}
            className="mt-0.5 size-4 accent-[var(--primary)]"
          />
          <span>
            <span className="text-sm font-medium text-foreground">{t("swap.instantTitle")}</span>
            <span className="block text-muted-foreground">{t("swap.instantBody")}</span>
          </span>
        </label>
      )}

      {pending && (
        <DepositInstructionsCard
          instructions={pending.instructions}
          onSimulate={() => void confirmTransfer()}
          simulating={simulating}
          simulated={simulated}
        />
      )}

      {!pending && (
        <ol className="grid gap-1 rounded-[var(--radius)] bg-secondary p-3 text-xs text-muted-foreground">
          {outTry ? (
            <>
              <li>{t("swap.step1In")}</li>
              <li>{t("swap.step2In")}</li>
              <li>{instant && relayEnabled() ? t("swap.step3Instant") : t("swap.step3Normal")}</li>
            </>
          ) : (
            <>
              <li>{t("swap.step1Out")}</li>
              <li>{t("swap.step2Out")}</li>
              <li>{t("swap.step3Out")}</li>
            </>
          )}
        </ol>
      )}

      {needsTrustline && (
        <p className="rounded-[var(--radius)] border border-destructive/40 bg-destructive/10 p-3 text-xs">
          {t("swap.needTrustline")}
        </p>
      )}

      {error && <ErrorState error={error} />}
      {receipt && <p className="rounded-[var(--radius)] bg-secondary p-3 text-xs">{receipt}</p>}
      <RampStatus stage={stage} detail={detail} address={address} onFixed={onDone} />

      {pending ? (
        <Button variant="ghost" onClick={reset} disabled={simulating || Boolean(stage)}>
          {t("ui.cancel")}
        </Button>
      ) : (
        <Button
          onClick={() => void (outTry ? getInstructions() : cashOut())}
          disabled={!ready || Boolean(ibanError)}
          loading={Boolean(stage)}
        >
          {!address
            ? t("ui.connectFirst")
            : stage
              ? t(BUTTON_STAGE[stage])
              : outTry
                ? t("swap.getInstructions")
                : t("swap.cashOut")}
        </Button>
      )}

      <p className="text-xs text-muted-foreground">{t("swap.counterparty")}</p>
    </div>
  );
}
