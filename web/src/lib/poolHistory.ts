import { scValToNative } from '@stellar/stellar-sdk';
import { server } from './amm';
import { config } from './config';
import { reservePrice, type PriceSample } from './chartData';

export interface PoolHistory { samples: PriceSample[]; fetchedAt: number; partial: boolean }
let cached: PoolHistory | null = null;
let throughLedger = 0;
let pending: Promise<PoolHistory> | null = null;

/** Deduplicate StrictMode requests; subsequent refreshes read only new ledgers. */
export function readPoolHistory(): Promise<PoolHistory> {
  if (!pending) pending = read().finally(() => { pending = null; });
  return pending;
}

async function read(): Promise<PoolHistory> {
  const health = await server.getHealth();
  const filters = [{ type: 'contract' as const, contractIds: [config.ammId] }];
  let oldestTime = 0;
  const samples = [...(cached?.samples ?? [])];
  let partial = cached?.partial ?? false;
  const start = Math.max(health.oldestLedger + 1, throughLedger + 1);
  // RPC scans at most 10,000 ledgers by default, even when returning no events.
  // Explicit, disjoint windows prevent an empty first page hiding recent events.
  const windows: Array<[number, number]> = [];
  for (let from = start; from <= health.latestLedger; from += 9999) {
    windows.push([from, Math.min(from + 9999, health.latestLedger + 1)]);
  }
  for (let batch = 0; batch < windows.length; batch += 4) {
    await Promise.all(windows.slice(batch, batch + 4).map(async ([from, to]) => {
      let cursor: string | undefined;
      for (let page = 0; page < 20; page++) {
        const result = await server.getEvents(cursor
          ? { filters, cursor, limit: 500 }
          : { filters, startLedger: from, endLedger: to, limit: 500 });
        oldestTime = Math.max(oldestTime, Number(result.oldestLedgerCloseTime) * 1000 || 0);
        for (const event of result.events) {
          if (event.ledger >= to || event.inSuccessfulContractCall === false) continue;
          const value: unknown = scValToNative(event.value);
          if (!value || typeof value !== 'object') continue;
          const reserves = value as Record<string, unknown>;
          const price = reservePrice(reserves.reserve_a, reserves.reserve_b);
          const time = Date.parse(event.ledgerClosedAt);
          if (price !== null && Number.isFinite(time)) samples.push({ id: event.id, time, price });
        }
        if (result.events.length < 500 || result.events.some(e => e.ledger >= to) || result.cursor === cursor) return;
        cursor = result.cursor;
      }
      partial = true;
    }));
  }
  throughLedger = health.latestLedger;
  cached = { samples: [...new Map(samples.filter(p => p.time >= oldestTime).map(p => [p.id, p])).values()], fetchedAt: Date.now(), partial };
  return cached;
}
