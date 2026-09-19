import { config } from "../lib/config";
import { truncateAddress } from "../lib/format";
import type { VaultTotals } from "../lib/history";
import type { VaultState } from "../lib/vault";
import { Card } from "./ui";

const tl = (n: number, digits = 2) =>
  n.toLocaleString("tr-TR", { minimumFractionDigits: digits, maximumFractionDigits: digits });

const usdc = (stroops: bigint, digits = 2) => tl(Number(stroops) / 1e7, digits);

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
  const windowLabel =
    windowHours === null
      ? "izlenen pencerede"
      : `son ${windowHours < 1 ? "<1" : Math.round(windowHours)} saatte`;
  const total = Number(vault.totalAssets) / 1e7;
  const advanced = Number(vault.totalAdvanced) / 1e7;
  const liquid = Number(vault.liquidAssets) / 1e7;
  // What share of the pool is working rather than sitting idle.
  const utilization = total > 0 ? (advanced / total) * 100 : 0;

  return (
    <Card className="grid gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="text-xs text-muted-foreground">Likidite kullanımı</p>
          <p className="tnum text-2xl font-semibold tracking-tight">
            {tl(utilization)}
            <span className="ml-1 text-sm font-medium text-muted-foreground">%</span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            <span className="tnum">{usdc(vault.totalAdvanced)}</span> USDC önden verilmiş,{" "}
            <span className="tnum">{usdc(vault.liquidAssets)}</span> USDC hazırda
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Stake edilmiş pay</p>
          <p className="text-2xl font-semibold tracking-tight text-muted-foreground">—</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Stake mekanizması yok; getiri doğrudan pay fiyatına yazılır.
          </p>
        </div>
      </div>

      <section>
        <h4 className="mb-2 text-sm font-medium">Bileşim</h4>
        <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 text-xs">
          <span className="text-muted-foreground">Varlık</span>
          <span className="text-right text-muted-foreground">Oran</span>
          <span className="text-right text-muted-foreground">Tutar</span>

          <span className="mt-1 flex items-baseline gap-2">
            USDC <Explorer id={vault.usdc} />
          </span>
          <span className="tnum mt-1 text-right">%100</span>
          <span className="tnum mt-1 text-right">{usdc(vault.totalAssets)}</span>

          <span className="pl-3 text-muted-foreground">· hazırda</span>
          <span className="tnum text-right text-muted-foreground">
            %{total > 0 ? tl((liquid / total) * 100) : "0,00"}
          </span>
          <span className="tnum text-right text-muted-foreground">
            {usdc(vault.liquidAssets)}
          </span>

          <span className="pl-3 text-muted-foreground">· önden verilmiş</span>
          <span className="tnum text-right text-muted-foreground">%{tl(utilization)}</span>
          <span className="tnum text-right text-muted-foreground">
            {usdc(vault.totalAdvanced)}
          </span>
        </div>
        <div className="mt-2 flex justify-between border-t border-border pt-2 text-xs">
          <span className="text-muted-foreground">Toplam</span>
          <span className="tnum">
            {usdc(vault.totalAssets)} USDC
            {rate ? ` · ${tl(total * rate)} TRY` : ""}
          </span>
        </div>
      </section>

      {totals && (
        <section>
          <h4 className="mb-2 text-sm font-medium">Hacim ve kazanç</h4>
          <Row label={`İşlem hacmi (${windowLabel})`}>{usdc(totals.volume)} USDC</Row>
          <Row label="· yatırma / çekme">
            {usdc(totals.depositVolume)} / {usdc(totals.withdrawVolume)}
          </Row>
          <Row label="Kazanılan çıkış komisyonu">{usdc(totals.withdrawFees, 4)} USDC</Row>
          <Row label="Kazanılan avans komisyonu">{usdc(totals.advanceFees, 4)} USDC</Row>
          <Row label="Açılan avans">{totals.advancesOpened}</Row>
          {totals.writtenOff > 0n && (
            <Row label="Batık yazılan">
              <span className="text-destructive">{usdc(totals.writtenOff)} USDC</span>
            </Row>
          )}
        </section>
      )}

      <section>
        <h4 className="mb-2 text-sm font-medium">Getiri kaynakları</h4>
        <Row label="Ölçülen yıllık getiri">
          {apr === null ? (
            <span className="text-muted-foreground">yeterli geçmiş yok</span>
          ) : (
            `%${tl(apr)}`
          )}
        </Row>
        <Row label="Çıkış komisyonu">%{tl(vault.withdrawFeeBps / 100, 2)}</Row>
        <Row label="Avans komisyonu">%{tl(vault.advanceFeeBps / 100, 2)}</Row>
        <Row label="Dağıtım">pay basılmadan gelen USDC → pay fiyatı</Row>
      </section>

      <section>
        <h4 className="mb-2 text-sm font-medium">Kontratlar</h4>
        <Row label="Kasa / pay token'ı">
          <Explorer id={config.vaultId} />
        </Row>
        <Row label="USDC (SAC)">
          <Explorer id={vault.usdc} />
        </Row>
        <Row label="Yönetici">
          <Explorer id={vault.admin} />
        </Row>
        <Row label="Avans relay'i">
          <Explorer id={vault.relay} />
        </Row>
        <Row label="Fiyat kaynağı">anchor SEP-38 · Reflector</Row>
        <Row label="Ağ">Stellar testnet</Row>
      </section>

      <section>
        <h4 className="mb-2 text-sm font-medium">Parametreler</h4>
        <Row label="Havuz tipi">tek varlıklı, pay muhasebeli kasa</Row>
        <Row label="Pay token'ı">
          {vault.symbol} · SEP-41 · 7 hane
        </Row>
        <Row label="Pay fiyatı">{tl(Number(vault.sharePrice) / 1e7, 7)} USDC</Row>
        <Row label="Dolaşımdaki pay">{usdc(vault.totalShares, 4)}</Row>
        <Row label="Mevduat tavanı">
          {vault.depositCapRaw > 0n ? `${usdc(vault.depositCapRaw)} USDC` : "sınırsız"}
        </Row>
        <Row label="Tek avans limiti">
          {vault.maxAdvance > 0n ? `${usdc(vault.maxAdvance)} USDC` : "kapalı"}
        </Row>
        <Row label="Toplam avans tavanı">
          {vault.advanceCap > 0n ? `${usdc(vault.advanceCap)} USDC` : "kapalı"}
        </Row>
        <Row label="Yatırımlar">{vault.paused ? "durduruldu" : "açık"}</Row>
        <Row label="Çekimler">her koşulda açık</Row>
      </section>

      <section>
        <h4 className="mb-2 text-sm font-medium">Riskler</h4>
        <ul className="grid list-disc gap-1.5 pl-4 text-xs text-muted-foreground">
          <li>
            <span className="text-foreground">Avanslar teminatsız.</span> Kasa, anchor teslim
            etmeden önce ödeme yapar ve geri ödemeyi zincir üzerinde zorlayamaz. Batık bir
            avans <span className="tnum">write_off</span> ile yazılır ve zarar doğrudan pay
            fiyatına düşer. Limitler bu yüzden küçük tutuluyor.
          </li>
          <li>
            <span className="text-foreground">Relay güvenilen bir bileşen.</span> Avansı
            açmaya yetkili tek taraf o. Havuzun parasını başka bir yere taşıyamaz, ama kimin
            avans alacağına o karar verir.
          </li>
          <li>
            <span className="text-foreground">Yönetici komisyonu ve tavanı değiştirebilir</span>{" "}
            (çıkış komisyonu en fazla %5) ve yatırımları durdurabilir. Çekimleri
            durduramaz.
          </li>
          <li>
            <span className="text-foreground">Likidite kullanımı yüksekken çekim beklemeli
            olabilir.</span> Çekim yalnızca hazırdaki USDC'den ödenir; avanslar geri gelince
            kalan da çekilebilir.
          </li>
          <li>
            <span className="text-foreground">Fiat tarafı anchor'a bağlı.</span> TL girişi ve
            çıkışı anchor'ın rayları üzerinden yürür; anchor duraksarsa TL bacağı duraksar.
          </li>
          <li>
            <span className="text-foreground">Testnet.</span> Gerçek para hareket etmiyor,
            kontrat denetlenmedi.
          </li>
        </ul>
      </section>
    </Card>
  );
}
