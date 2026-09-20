import { useState } from "react";

import { addAtryTrustline, type AccountState } from "../lib/account";
import { config } from "../lib/config";
import { defaultTryAmount, ibanProblem, isValidIban, normalizeIban, parseAmount } from "../lib/format";
import { num, useT, type Key } from "../lib/i18n";
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
import { Button, ErrorState, Field } from "./ui";

interface Pending {
  jwt: string;
  id: string;
  instructions: DepositInstructions;
}

/**
 * The fiat leg: lira in, lira out, through our own anchor.
 *
 * One aTRY is one lira the anchor is holding, so there is no rate on this
 * screen and nothing to quote — 1,000 TRY becomes 1,000 aTRY. Whatever a
 * lira is worth in dollars is settled next door, in the pool, by people
 * trading. Keeping the two apart is the whole point of the architecture:
 * the anchor is the only thing that touches a bank, and the contract is the
 * only thing that touches a price.
 */
export function RampCard({
  address,
  account,
  onDone,
}: {
  address: string | null;
  account: AccountState | null;
  onDone: () => void;
}) {
  const t = useT();
  const [mode, setMode] = useState<"in" | "out">("in");
  return (
    <div className="grid gap-4">
      <div
        role="tablist"
        aria-label={t("ramp2.group")}
        className="grid grid-cols-2 gap-1 rounded-[var(--radius)] bg-secondary p-1"
      >
        {(
          [
            ["in", t("ramp2.deposit")],
            ["out", t("ramp2.withdraw")],
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

      {mode === "in" ? (
        <DepositPanel address={address} account={account} onDone={onDone} />
      ) : (
        <WithdrawPanel address={address} account={account} onDone={onDone} />
      )}
    </div>
  );
}

function DepositPanel({
  address,
  account,
  onDone,
}: {
  address: string | null;
  account: AccountState | null;
  onDone: () => void;
}) {
  const t = useT();
  const [amount, setAmount] = useState(defaultTryAmount);
  const [pending, setPending] = useState<Pending | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [stage, setStage] = useState<RampStage | null>(null);
  const [detail, setDetail] = useState<RampDetail | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [fixing, setFixing] = useState(false);

  const typed = parseAmount(amount);
  // The anchor cannot deliver aTRY to an account that has not agreed to
  // hold it; the deposit would sit in `pending_trust` until it did.
  const needsTrustline = Boolean(account?.exists) && !account?.hasAtryTrustline;
  const ready = Boolean(address) && typed >= 50 && !needsTrustline && !stage && !pending;

  function fail(err: unknown) {
    if (!isUserRejection(err)) setError(err instanceof Error ? err : new Error(String(err)));
  }

  async function getInstructions() {
    if (!address) return;
    setError(null);
    setReceipt(null);
    try {
      setPending(
        await openDeposit(address, String(Math.round(typed)), (s, d) => {
          setStage(s);
          setDetail(d ?? null);
        }),
      );
      setConfirmed(false);
    } catch (err) {
      fail(err);
    } finally {
      setStage(null);
    }
  }

  async function confirmTransfer() {
    if (!pending) return;
    setConfirming(true);
    setError(null);
    try {
      await simulateBankTransfer(pending.jwt, pending.id);
      setConfirmed(true);
      const { usdc: delivered } = await awaitDeposit(pending.jwt, pending.id, (s, d) => {
        setStage(s);
        setDetail(d ?? null);
      });
      setReceipt(t("ramp2.received", { amount: num(Number(delivered)), code: config.atryCode }));
      setPending(null);
      setConfirmed(false);
      setDetail(null);
      onDone();
    } catch (err) {
      fail(err);
    } finally {
      setConfirming(false);
      setStage(null);
    }
  }

  return (
    <div className="grid gap-4">
      <Field
        label={t("ramp2.sendFromBank")}
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        inputMode="decimal"
        autoComplete="off"
        disabled={Boolean(pending)}
        suffix="TRY"
        hint={t("ramp2.oneForOne", { code: config.atryCode })}
      />

      {needsTrustline && address && (
        <div className="grid gap-2 rounded-[var(--radius)] border border-destructive/40 bg-destructive/10 p-3 text-xs">
          <p>{t("ramp2.needTrustline", { code: config.atryCode })}</p>
          <Button
            variant="ghost"
            className="justify-self-start"
            loading={fixing}
            onClick={async () => {
              setFixing(true);
              try {
                await addAtryTrustline(address);
                onDone();
              } catch (err) {
                fail(err);
              } finally {
                setFixing(false);
              }
            }}
          >
            {t("ramp2.acceptAtry", { code: config.atryCode })}
          </Button>
        </div>
      )}

      {pending ? (
        <DepositInstructionsCard
          instructions={pending.instructions}
          onSimulate={() => void confirmTransfer()}
          simulating={confirming}
          simulated={confirmed}
        />
      ) : (
        <ol className="grid gap-1 rounded-[var(--radius)] bg-secondary p-3 text-xs text-muted-foreground">
          <li>{t("ramp2.step1")}</li>
          <li>{t("ramp2.step2")}</li>
          <li>{t("ramp2.step3", { code: config.atryCode })}</li>
        </ol>
      )}

      {error && <ErrorState error={error} />}
      {receipt && <p className="rounded-[var(--radius)] bg-secondary p-3 text-xs">{receipt}</p>}
      <RampStatus stage={stage} detail={detail} address={address} onFixed={onDone} />

      {pending ? (
        <Button
          variant="ghost"
          onClick={() => {
            setPending(null);
            setConfirmed(false);
            setDetail(null);
          }}
          disabled={confirming || Boolean(stage)}
        >
          {t("ui.cancel")}
        </Button>
      ) : (
        <Button onClick={() => void getInstructions()} disabled={!ready} loading={Boolean(stage)}>
          {!address ? t("ui.connectFirst") : stage ? t(`stage.${stage}` as Key) : t("ramp2.getIban")}
        </Button>
      )}
    </div>
  );
}

function WithdrawPanel({
  address,
  account,
  onDone,
}: {
  address: string | null;
  account: AccountState | null;
  onDone: () => void;
}) {
  const t = useT();
  const [amount, setAmount] = useState("");
  const [iban, setIban] = useState("");
  const [bank, setBank] = useState("");
  const [stage, setStage] = useState<RampStage | null>(null);
  const [detail, setDetail] = useState<RampDetail | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);

  const typed = parseAmount(amount);
  const held = account?.atry ?? 0;
  const over = Boolean(account?.exists) && typed > held;
  const ibanError = ibanProblem(iban);
  const ready = Boolean(address) && typed > 0 && !over && isValidIban(iban) && !stage;

  return (
    <div className="grid gap-4">
      <Field
        label={t("ramp2.sendBack", { code: config.atryCode })}
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        inputMode="decimal"
        autoComplete="off"
        placeholder="0"
        suffix={config.atryCode}
        error={over ? t("swap2.overBalance", { amount: num(held), code: config.atryCode }) : null}
        {...(account?.exists && !over
          ? { hint: t("swap2.balance", { amount: num(held), code: config.atryCode }) }
          : {})}
      />
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

      <p className="rounded-[var(--radius)] bg-secondary p-3 text-xs text-muted-foreground">
        {t("ramp2.burnNote", { code: config.atryCode })}
      </p>

      {error && <ErrorState error={error} />}
      {receipt && <p className="rounded-[var(--radius)] bg-secondary p-3 text-xs">{receipt}</p>}
      <RampStatus stage={stage} detail={detail} address={address} onFixed={onDone} />

      <Button
        disabled={!ready}
        loading={Boolean(stage)}
        onClick={async () => {
          if (!address) return;
          setError(null);
          setReceipt(null);
          try {
            const out = await withdrawToIban(
              address,
              typed.toFixed(7),
              normalizeIban(iban),
              bank,
              (s, d) => {
                setStage(s);
                setDetail(d ?? null);
              },
            );
            setReceipt(t("ramp2.paidOut", { amount: num(Number(out.try)) }));
            setAmount("");
            onDone();
          } catch (err) {
            if (!isUserRejection(err))
              setError(err instanceof Error ? err : new Error(String(err)));
          } finally {
            setStage(null);
            setDetail(null);
          }
        }}
      >
        {!address ? t("ui.connectFirst") : stage ? t(`stage.${stage}` as Key) : t("ramp2.withdrawCta")}
      </Button>
    </div>
  );
}
