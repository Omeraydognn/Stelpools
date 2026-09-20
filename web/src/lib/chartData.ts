export interface PriceSample { id: string; time: number; price: number }
export interface Candle { time: number; open: number; high: number; low: number; close: number; count: number }

/** Only observed reserve prices enter OHLC; empty intervals stay empty. */
export function aggregateCandles(samples: PriceSample[], interval: number, since = 0): Candle[] {
  const buckets = new Map<number, Candle>();
  const seen = new Set<string>();
  for (const sample of [...samples].sort((a, b) => a.time - b.time || a.id.localeCompare(b.id))) {
    if (seen.has(sample.id) || sample.time < since || !Number.isFinite(sample.price) || sample.price <= 0) continue;
    seen.add(sample.id);
    const time = Math.floor(sample.time / interval) * interval;
    const candle = buckets.get(time);
    if (candle) {
      candle.high = Math.max(candle.high, sample.price);
      candle.low = Math.min(candle.low, sample.price);
      candle.close = sample.price;
      candle.count++;
    } else buckets.set(time, { time, open: sample.price, high: sample.price, low: sample.price, close: sample.price, count: 1 });
  }
  return [...buckets.values()];
}

export function reservePrice(a: unknown, b: unknown): number | null {
  if (typeof a !== 'bigint' || typeof b !== 'bigint' || a <= 0n || b <= 0n) return null;
  const price = Number(b) / Number(a);
  return Number.isFinite(price) && price > 0 ? price : null;
}
