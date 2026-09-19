import { useState } from "react";

import { loadAccount, type AccountState } from "../lib/account";
import { indicativePrice } from "../lib/anchor";
import { config } from "../lib/config";
import {
  formatUsdc,
  ibanProblem,
  isValidIban,
  normalizeIban,
  parseUsdcToStroops,
} from "../lib/format";
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

const tl = (n: number) =>
  n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const STAGE_COPY: Record<string, string> = {
  building: "Hazırlanıyor…",
  signing: "Cüzdanınızda imzalayın…",
  submitting: "Gönderiliyor…",
  confirming: "Onay bekleniyor…",
  authenticating: "Anchor'a bağlanılıyor…",
  registering: "Kimlik kaydı yapılıyor…",
  requesting: "Anchor işlemi açılıyor…",
  transferring: "Transfer gönderiliyor…",
  waiting: "Anchor işliyor…",
  done: "Tamamlandı",
};

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
  const tvl = Number(tvlUsdc) / 1e7;
  const stats: Array<[string, string]> = [
    ["TVL", `${tl(tvl)} USDC`],
    ["TVL (TRY)", rate ? `${tl(tvl * rate)} TRY` : "—"],
    ["Pay fiyatı", `${(Number(sharePrice) / 1e7).toLocaleString("tr-TR", { maximumFractionDigits: 6 })} USDC`],
    ["Çıkış komisyonu", `%${(feeBps / 100).toLocaleString("tr-TR")}`],
    ["Getiri (yıllık)", apr === null ? "—" : `%${apr.toLocaleString("tr-TR", { maximumFractionDigits: 2 })}`],
    ...(advanced > 0n
      ? ([["Önden verilen", `${tl(Number(advanced) / 1e7)} USDC`]] as Array<[string, string]>)
      : []),
  ];
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-4">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">USDC / TRY</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          TRY'yi USDC'ye çevir, istersen kasada çalıştır, istediğinde geri çık.{" "}
          <a
            href={explorerContract()}
            target="_blank"
            rel="noreferrer"
            className="text-primary underline underline-offset-4"
          >
            Kontrat
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
      {STAGE_COPY[stage] ?? stage}
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
  const usdcBalance = account?.usdc ?? 0;
  // The anchor cannot deliver USDC to an account without a trustline; the
  // deposit would sit in `pending_trust` indefinitely.
  const needsTrustline = Boolean(account?.exists) && !account?.hasUsdcTrustline;
  const [mode, setMode] = useState<"try" | "usdc">("try");
  const [tryAmount, setTryAmount] = useState("1.000");
  const [usdcAmount, setUsdcAmount] = useState("10");
  const [stage, setStage] = useState<string | null>(null);
  const [rampDetail, setRampDetail] = useState<RampDetail | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);

  const tryValue = Number(tryAmount.replace(/\./g, "").replace(",", ".")) || 0;
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
      <div role="tablist" aria-label="Yatırma yöntemi" className="grid grid-cols-2 gap-1 rounded-[var(--radius)] bg-secondary p-1">
        {(
          [
            ["try", "TRY ile"],
            ["usdc", "USDC ile"],
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
            label="Yatırılacak"
            value={tryAmount}
            onChange={(e) => setTryAmount(e.target.value)}
            inputMode="decimal"
            autoComplete="off"
            suffix="TRY"
            hint="Anchor limitleri: 50 – 3.000 TRY"
          />
          <div className="rounded-[var(--radius)] border border-border bg-card p-3">
            <p className="mb-1 text-xs text-muted-foreground">Kasaya girecek (tahmini)</p>
            <Amount
              value={estimatedUsdc ? tl(estimatedUsdc) : "—"}
              unit="USDC"
              size="lg"
            />
            <p className="mt-2 text-xs text-muted-foreground">
              Kur <span className="tnum">{rate ? tl(rate) : "—"}</span> TRY/USDC — anchor'ın
              SEP-38 fiyatlaması. Kurdaki ani ve yüksek dalgalanmalar bizden kaynaklanmaz.
            </p>
          </div>
          <ol className="grid gap-1 rounded-[var(--radius)] bg-secondary p-3 text-xs text-muted-foreground">
            <li>1. Anchor'a TRY transferi (sandbox'ta simüle edilir) → cüzdanınıza USDC geçer</li>
            <li>2. Aynı akışta USDC kasaya yatırılır ve pay alırsınız</li>
          </ol>
        </>
      ) : (
        <>
          <Field
            label="Yatırılacak"
            value={usdcAmount}
            onChange={(e) => setUsdcAmount(e.target.value)}
            inputMode="decimal"
            autoComplete="off"
            suffix="USDC"
            hint={`Cüzdanınızda ${tl(usdcBalance)} USDC var.`}
          />
          <button
            type="button"
            onClick={() => setUsdcAmount(String(usdcBalance))}
            className="justify-self-start rounded-[var(--radius)] px-2 py-1 text-xs font-medium text-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Tümü
          </button>
        </>
      )}

      {mode === "try" && needsTrustline && (
        <p className="rounded-[var(--radius)] border border-destructive/40 bg-destructive/10 p-3 text-xs">
          Cüzdanınızda USDC trustline yok. Anchor USDC'yi gönderemez ve işlem beklemede kalır.
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
            if (!address) throw new Error("Cüzdan bağlı değil");
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
              if (!assets) throw new Error("Anchor'dan gelen tutar okunamadı.");
              const { shares } = await deposit(address, assets, setStage);
              return `${formatUsdc(assets)} USDC kasaya yatırıldı, ${formatUsdc(shares)} pay aldınız.`;
            }
            if (!usdcStroops) throw new Error("Geçerli bir USDC tutarı girin.");
            const { shares, hash } = await deposit(address, usdcStroops, setStage);
            return `${formatUsdc(shares)} pay aldınız. İşlem: ${hash.slice(0, 10)}…`;
          })
        }
      >
        {!address
          ? "Önce cüzdan bağlayın"
          : stage
            ? (STAGE_COPY[stage] ?? "Çalışıyor…")
            : mode === "try"
              ? "TRY yatır ve kasaya gir"
              : "Kasaya yatır"}
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
        label="Çekilecek pay"
        value={shares}
        onChange={(e) => setShares(e.target.value)}
        inputMode="decimal"
        autoComplete="off"
        suffix={symbol}
        placeholder="0"
        hint={`${tl(held)} ${symbol} payınız var, bugünkü değeri ${tl(Number(userAssets) / 1e7)} USDC.`}
      />
      <button
        type="button"
        onClick={() => setShares(String(held))}
        className="justify-self-start rounded-[var(--radius)] px-2 py-1 text-xs font-medium text-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Tümü
      </button>

      <div className="rounded-[var(--radius)] border border-border bg-card p-3">
        <p className="mb-1 text-xs text-muted-foreground">Alacağınız</p>
        <Amount value={estimated ? tl(estimated) : "—"} unit="USDC" size="lg" />
        <p className="mt-2 text-xs text-muted-foreground">
          %{(feeBps / 100).toLocaleString("tr-TR")} çıkış komisyonu düşülür ve kasada kalır;
          yani kasada kalanların payına yazılır.
          {rate && estimated ? ` ≈ ${tl(estimated * rate)} TRY` : ""}
        </p>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={toBank}
          onChange={(e) => setToBank(e.target.checked)}
          className="size-4 accent-[var(--primary)]"
        />
        Devamında TRY olarak banka hesabıma gönder
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
            label="Banka adı"
            value={bank}
            onChange={(e) => setBank(e.target.value)}
            autoComplete="off"
            placeholder="Örn. Akbank"
          />
          <p className="rounded-[var(--radius)] bg-secondary p-3 text-xs text-muted-foreground">
            USDC önce cüzdanınıza iner, sonra anchor'ın hazinesine gönderilir ve anchor TRY'yi
            IBAN'ınıza öder. İki imza istenir.
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
            let note = `${formatUsdc(assets)} USDC cüzdanınıza çekildi. İşlem: ${hash.slice(0, 10)}…`;
            if (toBank && isValidIban(iban)) {
              const out = await withdrawToIban(
                address,
                (Number(assets) / 1e7).toFixed(7),
                normalizeIban(iban),
                bank,
                (s: RampStage) => setStage(s),
              );
              note += ` Anchor ${tl(Number(out.try))} TRY'yi IBAN'ınıza gönderdi.`;
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
          ? "Önce cüzdan bağlayın"
          : stage
            ? (STAGE_COPY[stage] ?? "Çalışıyor…")
            : toBank
              ? "Çek ve TRY olarak gönder"
              : "Kasadan çek"}
      </Button>
    </div>
  );
}

export function VaultView({ address }: { address: string | null }) {
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
              <h3 className="text-sm font-medium">Pay fiyatı</h3>
              <p className="text-xs text-muted-foreground">
                Kasanın kendi event'lerinden; RPC'nin sakladığı son ledger penceresi kadar
                geriye gider.
              </p>
            </div>
            {history.initial && history.loading ? (
              <Skeleton className="h-[120px]" />
            ) : history.data ? (
              <PriceChart history={history.data} />
            ) : null}
          </Card>

          <Card className="grid gap-3">
            <h3 className="text-sm font-medium">Pozisyonunuz</h3>
            {!address ? (
              <p className="text-sm text-muted-foreground">
                Pozisyonunuzu görmek için cüzdanınızı bağlayın.
              </p>
            ) : userShares === 0n ? (
              <p className="text-sm text-muted-foreground">
                Kasada payınız yok. Sağdaki panelden TRY ya da USDC ile girebilirsiniz.
              </p>
            ) : (
              <>
                <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                  {[
                    ["Payınız", `${tl(Number(userShares) / 1e7)} ${symbol}`],
                    ["Değeri", `${tl(Number(userAssets) / 1e7)} USDC`],
                    ["TRY karşılığı", rate ? `${tl((Number(userAssets) / 1e7) * rate)} TRY` : "—"],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-xs text-muted-foreground">{label}</dt>
                      <dd className="tnum text-base font-semibold">{value}</dd>
                    </div>
                  ))}
                </dl>
                {pnl && (
                  <p className="text-xs text-muted-foreground">
                    Bu pencerede net{" "}
                    <span className="tnum">{tl(Number(pnl.netContributed) / 1e7)}</span> USDC
                    koydunuz, bugünkü değeri{" "}
                    <span className="tnum">{tl(Number(userAssets) / 1e7)}</span> USDC —{" "}
                    <span className={pnl.gain >= 0 ? "text-primary" : "text-destructive"}>
                      {pnl.gain >= 0 ? "+" : "−"}
                      <span className="tnum">{tl(Math.abs(pnl.gain) / 1e7)}</span> USDC
                    </span>
                    . Daha eski yatırmalar bu hesaba girmez.
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
            <h3 className="text-sm font-medium text-foreground">Nasıl çalışıyor</h3>
            <p>
              Fiat hiç kontrata girmez. TL, anchor'ın kurumsal IBAN'ı üzerinden girer ve çıkar;
              kontrat yalnızca USDC havuzunu ve payları tutar.
            </p>
            <p>
              Kasaya gelen her USDC, pay basılmadan geldiğinde (çıkış komisyonu, getiri
              dağıtımı) mevcut payların değerini yükseltir. Pay fiyatı bu yüzden yalnızca artar.
            </p>
            <p>
              Payınız <span className="tnum text-foreground">{symbol}</span> adlı bir SEP-41
              token. Transfer edilebilir, bir başkasına yetki verilebilir, cüzdanda görünür —
              başka ağlardaki LP token'ları gibi. Payı kime gönderirseniz kasadaki hak da
              onunla birlikte gider.
            </p>
            <p>
              Çekimler hiçbir koşulda durdurulamaz — yatırımlar duraklatılsa bile.
              {depositCap > 0n && (
                <> Mevduat tavanı {tl(Number(depositCap) / 1e7)} USDC.</>
              )}
            </p>
          </Card>
        </div>

        <Card className="grid gap-4 self-start">
          <div role="tablist" aria-label="İşlem" className="grid grid-cols-3 gap-1 rounded-[var(--radius)] bg-secondary p-1">
            {(
              [
                ["swap", "Takas"],
                ["deposit", "Yatır"],
                ["withdraw", "Çek"],
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
              Yatırımlar geçici olarak durduruldu. Çekimler açık.
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
