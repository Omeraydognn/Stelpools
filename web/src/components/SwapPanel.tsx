import { useState } from "react";

import type { AccountState } from "../lib/account";
import { ibanProblem, isValidIban, normalizeIban, parseUsdcToStroops } from "../lib/format";
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

const tl = (n: number) =>
  n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const BUTTON_COPY: Record<RampStage, string> = {
  authenticating: "Anchor'a bağlanılıyor…",
  registering: "Kimlik kaydı yapılıyor…",
  requesting: "Talimat alınıyor…",
  transferring: "Transfer bildiriliyor…",
  waiting: "Anchor işliyor…",
  done: "Tamamlandı",
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
 * "anında al" does.
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
  const [direction, setDirection] = useState<"tryToUsdc" | "usdcToTry">("tryToUsdc");
  const [tryAmount, setTryAmount] = useState("1.000");
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
  const tryValue = Number(tryAmount.replace(/\./g, "").replace(",", ".")) || 0;
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
          `${tl(Number(advance.paid_out_usdc))} USDC havuzdan hemen cüzdanınıza geçti. ` +
            `Anchor'ın USDC'si geldiğinde ${tl(Number(advance.owed_usdc))} USDC'lik avansı kapatın.`,
        );
        void awaitDeposit(pending.jwt, pending.id).then(onDone).catch(() => undefined);
        reset();
        return;
      }

      const { usdc } = await awaitDeposit(pending.jwt, pending.id, (s, d) => {
        setStage(s);
        setDetail(d ?? null);
      });
      setReceipt(
        `${tl(Number(usdc))} USDC cüzdanınıza geçti. Kasaya yatırmak isterseniz "Yatır" sekmesi.`,
      );
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
      setReceipt(`Anchor ${tl(Number(out.try))} TRY'yi IBAN'ınıza gönderdi.`);
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
          label={outTry ? "Ödeyeceğiniz" : "Satacağınız"}
          value={outTry ? tryAmount : usdcAmount}
          onChange={(e) => (outTry ? setTryAmount(e.target.value) : setUsdcAmount(e.target.value))}
          inputMode="decimal"
          autoComplete="off"
          disabled={Boolean(pending)}
          suffix={outTry ? "TRY" : "USDC"}
          error={
            tryOutOfRange
              ? `Anchor limitleri ${MIN_TRY} – ${tl(MAX_TRY)} TRY.`
              : notEnoughUsdc
                ? `Cüzdanınızda ${tl(account?.usdc ?? 0)} USDC var.`
                : null
          }
          {...(!outTry && account?.exists
            ? { hint: `Cüzdanınızda ${tl(account.usdc)} USDC var.` }
            : {})}
        />

        <button
          type="button"
          onClick={() => {
            reset();
            setDirection(outTry ? "usdcToTry" : "tryToUsdc");
          }}
          aria-label="Yönü çevir"
          className="mx-auto flex size-10 items-center justify-center rounded-full border border-border bg-card text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          ↓↑
        </button>

        <div className="rounded-[var(--radius)] border border-border bg-card p-3">
          <p className="mb-1 text-xs text-muted-foreground">Alacağınız</p>
          <Amount value={estimate ? tl(estimate) : "—"} unit={outTry ? "USDC" : "TRY"} size="lg" />
          <p className="mt-2 text-xs text-muted-foreground">
            Kur <span className="tnum">{rate ? tl(rate) : "—"}</span> TRY/USDC — anchor'ın SEP-38
            fiyatlaması, %0,5 spread dahil. Kurdaki ani ve yüksek dalgalanmalar bizden
            kaynaklanmaz.
          </p>
        </div>
      </div>

      {!outTry && (
        <div className="grid gap-3">
          <Field
            label="TRY'yi alacağınız IBAN"
            value={iban}
            onChange={(e) => setIban(e.target.value)}
            placeholder="TR00 0000 0000 0000 0000 0000 00"
            autoComplete="off"
            spellCheck={false}
            error={ibanError}
          />
          <Field
            label="Banka adı"
            value={bank}
            onChange={(e) => setBank(e.target.value)}
            autoComplete="off"
            placeholder="Örn. Akbank"
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
            <span className="text-sm font-medium text-foreground">Anında al</span>
            <span className="block text-muted-foreground">
              Havaleyi bildirdiğiniz anda havuz USDC'yi verir; anchor'ın USDC'si geldiğinde
              avansı kapatırsınız. %0,3 komisyon havuzda kalır.
            </span>
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
              <li>1. Anchor kimliğinizi doğrular ve size kendi IBAN'ını + bir kod verir</li>
              <li>2. Bankanızdan o IBAN'a, açıklamaya kodu yazarak TRY gönderirsiniz</li>
              <li>
                3.{" "}
                {instant && relayEnabled()
                  ? "Havuz USDC'yi hemen öder; anchor'ınki gelince avansı kapatırsınız"
                  : "Anchor parayı görünce USDC'yi Stellar cüzdanınıza gönderir"}
              </li>
            </>
          ) : (
            <>
              <li>1. IBAN'ınız anchor'a SEP-12 ile kaydedilir</li>
              <li>2. USDC'niz anchor hazinesine memo'lu ödemeyle gider</li>
              <li>3. Anchor TRY'yi IBAN'ınıza öder (FAST)</li>
            </>
          )}
        </ol>
      )}

      {needsTrustline && (
        <p className="rounded-[var(--radius)] border border-destructive/40 bg-destructive/10 p-3 text-xs">
          Cüzdanınızda USDC trustline yok. Anchor USDC'yi gönderemez ve işlem sonsuza kadar
          bekler — yukarıdaki "USDC'yi tanımla" düğmesiyle açın.
        </p>
      )}

      {error && <ErrorState error={error} />}
      {receipt && <p className="rounded-[var(--radius)] bg-secondary p-3 text-xs">{receipt}</p>}
      <RampStatus stage={stage} detail={detail} address={address} onFixed={onDone} />

      {pending ? (
        <Button variant="ghost" onClick={reset} disabled={simulating || Boolean(stage)}>
          Vazgeç
        </Button>
      ) : (
        <Button
          onClick={() => void (outTry ? getInstructions() : cashOut())}
          disabled={!ready || Boolean(ibanError)}
          loading={Boolean(stage)}
        >
          {!address
            ? "Önce cüzdan bağlayın"
            : stage
              ? BUTTON_COPY[stage]
              : outTry
                ? "Yatırma talimatı al"
                : "USDC'yi TRY'ye çevir"}
        </Button>
      )}

      <p className="text-xs text-muted-foreground">
        Bu takasın karşı tarafı anchor'dır, havuz değil — hiçbir kontrat banka bakiyesi
        tutamaz. Havuz USDC'yi tutar, getirisini üretir ve isterseniz anchor'ı beklemeden
        önden öder.
      </p>
    </div>
  );
}
