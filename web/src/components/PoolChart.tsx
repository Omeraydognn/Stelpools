import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { aggregateCandles } from '../lib/chartData';
import { config } from '../lib/config';
import { locale, num } from '../lib/i18n';
import { readPoolHistory } from '../lib/poolHistory';
import { useAsync } from '../lib/useAsync';
import { useCopy } from '../lib/useCopy';
import { Card } from './ui';

const LEFT = 12, RIGHT = 88, TOP = 26, BOTTOM = 32;
const ranges = [
  { key: '1H', duration: 3_600_000, interval: 60_000 },
  { key: '24H', duration: 86_400_000, interval: 900_000 },
  { key: '7D', duration: 604_800_000, interval: 3_600_000 },
  { key: 'ALL', duration: Infinity, interval: 3_600_000 },
] as const;

export function PoolChart({ spotPrice, refreshKey }: { spotPrice: bigint; refreshKey: number }) {
  const c = useCopy();
  const canvas = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(760);
  useEffect(() => {
    if (!canvas.current) return;
    const observer = new ResizeObserver(entries => setWidth(entries[0].contentRect.width));
    observer.observe(canvas.current);
    return () => observer.disconnect();
  }, []);
  const W = Math.max(280, width), H = width < 500 ? 280 : 360;
  const tickCount = width < 500 ? 3 : 4;
  const history = useAsync(readPoolHistory, [refreshKey], 60_000);
  const [range, setRange] = useState('ALL');
  const [mode, setMode] = useState<'candles' | 'line'>('candles');
  const [hover, setHover] = useState<number | null>(null);
  const gradientId = useId();
  const chosen = ranges.find(r => r.key === range)!;
  const sampleTimes = history.data?.samples.map(p => p.time) ?? [];
  const observedSpan = sampleTimes.length ? Math.max(...sampleTimes) - Math.min(...sampleTimes) : 0;
  const interval = chosen.key === 'ALL' && observedSpan < 86_400_000 ? 300_000 : chosen.interval;
  const candles = useMemo(() => aggregateCandles(history.data?.samples ?? [], interval,
    chosen.duration === Infinity ? 0 : (history.data?.fetchedAt ?? 0) - chosen.duration), [history.data, chosen, interval]);
  const selected = candles[hover === null ? candles.length - 1 : Math.min(hover, candles.length - 1)];
  const first = candles[0];
  const last = candles.at(-1);
  const change = first && last ? (last.close / first.open - 1) * 100 : null;
  const displayPrice = selected?.close ?? Number(spotPrice) / 1e7;
  const low = candles.length ? Math.min(...candles.map(p => p.low)) : 0;
  const high = candles.length ? Math.max(...candles.map(p => p.high)) : 1;
  const pad = (high - low || high * .002 || 1) * .16;
  const floor = Math.max(0, low - pad), ceiling = high + pad;
  const start = (first?.time ?? 0) - interval;
  const end = (last?.time ?? interval) + interval;
  const x = (time: number) => LEFT + (time - start) / (end - start) * (W - LEFT - RIGHT);
  const y = (price: number) => TOP + (ceiling - price) / (ceiling - floor) * (H - TOP - BOTTOM);
  const bodyWidth = Math.max(2, Math.min(14, interval / (end - start) * (W - LEFT - RIGHT) * .65));
  const line = candles.map((p, i) => `${i ? 'L' : 'M'}${x(p.time)},${y(p.close)}`).join(' ');
  const date = (time: number) => new Date(time).toLocaleString(locale(), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const tickDate = (time: number) => new Date(time).toLocaleString(locale(), end - start <= 172_800_000 ? { hour: '2-digit', minute: '2-digit' } : { month: 'short', day: 'numeric' });
  const status = history.initial && history.loading ? 'loading' : candles.length ? 'ready' : history.error ? 'error' : 'empty';

  return <Card className="pool-chart">
    <div className="chart-heading"><div><span className="chart-eyebrow">{c('POOL PRICE', 'HAVUZ FİYATI')}</span><h3>USDC / {config.atryCode}</h3></div><span className="chart-source"><span className="status-dot"/>{c('On-chain', 'Zincir üstü')}</span></div>
    <div className="chart-summary"><strong className="tnum">{displayPrice > 0 ? num(displayPrice, 4) : '—'} <small>{config.atryCode}</small></strong>{change !== null && <span className={`chart-change ${change < 0 ? 'is-negative' : ''}`}>{change >= 0 ? '+' : ''}{num(change, 2)}% <small>{c('observed range', 'gözlenen aralık')}</small></span>}</div>
    <div className="chart-toolbar"><div className="chart-toggle" role="group" aria-label={c('Chart style', 'Grafik türü')}>{(['candles', 'line'] as const).map(style => <button key={style} type="button" aria-pressed={mode === style} onClick={() => setMode(style)}>{style === 'candles' ? c('Candles', 'Mum') : c('Line', 'Çizgi')}</button>)}</div><div className="chart-ranges" role="group" aria-label={c('Time range', 'Zaman aralığı')}>{ranges.map(r => <button key={r.key} type="button" aria-pressed={range === r.key} onClick={() => { setRange(r.key); setHover(null); }}>{r.key === 'ALL' ? c('All', 'Tümü') : r.key === '7D' ? c('7D', '7G') : r.key === '24H' ? c('24H', '24S') : c('1H', '1S')}</button>)}</div></div>
    <div className="chart-ohlc" aria-live="off">{selected ? <><span>{date(selected.time)}</span>{[['O', selected.open], ['H', selected.high], ['L', selected.low], ['C', selected.close]].map(([label, value]) => <span key={label}><abbr title={label === 'O' ? c('Open', 'Açılış') : label === 'H' ? c('High', 'En yüksek') : label === 'L' ? c('Low', 'En düşük') : c('Close', 'Kapanış')}>{label}</abbr> <b className="tnum">{num(Number(value), 4)}</b></span>)}</> : <span>{c('Reserve price ·', 'Rezerv fiyatı ·')} {config.atryCode} / USDC</span>}</div>
    <div ref={canvas} className="chart-canvas">{status === 'ready' ? <svg className="market-chart" width={W} height={H} style={{ aspectRatio: `${W} / ${H}` }} viewBox={`0 0 ${W} ${H}`} role="img" tabIndex={0} aria-label={c('Pool price chart. Use left and right arrows to inspect candles.', 'Havuz fiyat grafiği. Mumları incelemek için sol ve sağ okları kullanın.')} onKeyDown={e => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape'].includes(e.key)) return;
      e.preventDefault();
      if (e.key === 'Escape') return setHover(null);
      setHover(i => e.key === 'Home' ? 0 : e.key === 'End' ? candles.length - 1 : Math.max(0, Math.min(candles.length - 1, (i ?? candles.length - 1) + (e.key === 'ArrowLeft' ? -1 : 1))));
    }} onPointerMove={e => {
      const rect = e.currentTarget.getBoundingClientRect();
      const position = (e.clientX - rect.left) / rect.width * W;
      let nearest = 0;
      candles.forEach((p, i) => { if (Math.abs(x(p.time) - position) < Math.abs(x(candles[nearest].time) - position)) nearest = i; });
      setHover(nearest);
    }} onPointerLeave={() => setHover(null)} onBlur={() => setHover(null)}>
      <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--primary)" stopOpacity=".18"/><stop offset="100%" stopColor="var(--primary)" stopOpacity="0"/></linearGradient></defs>
      {Array.from({length:5}, (_,i) => { const price = floor + (ceiling - floor) * i / 4; return <g key={i}><line x1={LEFT} x2={W - RIGHT} y1={y(price)} y2={y(price)} className="chart-grid"/><text x={W - RIGHT + 12} y={y(price) + 4} className="chart-axis">{num(price, 4)}</text></g>; })}
      {Array.from({length:tickCount}, (_,i) => { const time = start + (end - start) * (i + .35) / tickCount; return <g key={i}><line x1={x(time)} x2={x(time)} y1={TOP} y2={H - BOTTOM} className="chart-grid"/><text x={x(time)} y={H - 7} textAnchor="middle" className="chart-axis">{tickDate(time)}</text></g>; })}
      {mode === 'line' ? <><path d={`${line} L${x(last!.time)},${H - BOTTOM} L${x(first.time)},${H - BOTTOM} Z`} fill={`url(#${gradientId})`}/><path d={line} fill="none" stroke="var(--primary)" strokeWidth="2"/>{candles.length === 1 && <circle cx={x(first.time)} cy={y(first.close)} r="4" fill="var(--primary)"/>}</> : candles.map(p => <g key={p.time} stroke={p.close >= p.open ? 'var(--primary)' : 'var(--destructive)'} fill={p.close >= p.open ? 'var(--primary)' : 'var(--destructive)'}><title>{`${date(p.time)} · O ${p.open} H ${p.high} L ${p.low} C ${p.close}`}</title><line x1={x(p.time)} x2={x(p.time)} y1={y(p.high)} y2={y(p.low)} strokeWidth="1.2"/><rect x={x(p.time) - bodyWidth / 2} y={Math.min(y(p.open), y(p.close))} width={bodyWidth} height={Math.max(1.5, Math.abs(y(p.open) - y(p.close)))}/></g>)}
      <line x1={LEFT} x2={W - RIGHT} y1={y(last!.close)} y2={y(last!.close)} stroke="var(--primary)" strokeDasharray="4 5" opacity=".65"/>
      {hover !== null && selected && <g><line x1={x(selected.time)} x2={x(selected.time)} y1={TOP} y2={H - BOTTOM} stroke="var(--muted-foreground)" strokeDasharray="3 4"/><circle cx={x(selected.time)} cy={y(selected.close)} r="4" fill="var(--card)" stroke="var(--primary)" strokeWidth="2"/></g>}
      <rect x={W - RIGHT + 4} y={y(last!.close) - 10} width={RIGHT - 5} height="21" rx="2" fill="var(--forest)"/><text x={W - RIGHT + 11} y={y(last!.close) + 4} className="chart-axis chart-price-label">{num(last!.close, 4)}</text>
    </svg> : <div className={`chart-placeholder ${status === 'loading' ? 'chart-loading' : ''}`} role="status" aria-busy={status === 'loading'}><span className="chart-placeholder-icon" aria-hidden>↗</span><strong>{status === 'loading' ? c('Loading price history…', 'Fiyat geçmişi yükleniyor…') : status === 'error' ? c('Price history is unavailable', 'Fiyat geçmişi alınamadı') : c('No price observations in this range', 'Bu aralıkta fiyat gözlemi yok')}</strong><p>{status === 'error' ? c('Try fetching the on-chain events again.', 'Zincir üstü verileri tekrar yüklemeyi deneyin.') : c('Only recorded pool events appear here.', 'Burada yalnızca kaydedilmiş havuz işlemleri gösterilir.')}</p>{status !== 'loading' && <button type="button" onClick={() => { if (status === 'empty' && range !== 'ALL') setRange('ALL'); else history.reload(); }}>{status === 'empty' && range !== 'ALL' ? c('Show all history', 'Tüm geçmişi göster') : c('Retry', 'Tekrar dene')}</button>}</div>}</div>
    <p className="sr-only" aria-live="polite">{hover !== null && selected ? `${date(selected.time)}: ${num(selected.close, 4)} ${config.atryCode}` : ""}</p>
    <div className="chart-footer"><span>{c('Source: pool reserve events. Gaps mean no observations.', 'Kaynak: havuz rezerv olayları. Boşluklar gözlem olmadığını gösterir.')}</span><button type="button" disabled={history.loading} onClick={history.reload}>{history.loading ? c('Updating…', 'Güncelleniyor…') : c('Refresh ↻', 'Yenile ↻')}</button></div>
    <p className="chart-retention">{c('History is limited to the RPC retention window. Candles aggregate observed prices, not exchange trades.', 'Geçmiş, RPC saklama süresiyle sınırlıdır. Mumlar gözlenen fiyatları özetler; borsa işlem mumları değildir.')} {history.data?.partial && c('Only a partial history was retrieved.', 'Geçmişin yalnızca bir kısmı alınabildi.')} {history.error && history.data && c('Refresh failed; showing the last loaded history.', 'Yenileme başarısız; son yüklenen geçmiş gösteriliyor.')}</p>
  </Card>;
}
