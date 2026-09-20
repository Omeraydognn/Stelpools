import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateCandles, reservePrice } from '../src/lib/chartData.ts';

test('builds ordered OHLC from reserve observations and deduplicates event IDs', () => {
  const samples = [
    { id: 'c', time: 3000, price: 49 },
    { id: 'a', time: 1000, price: 50 },
    { id: 'b', time: 2000, price: 52 },
    { id: 'c', time: 3000, price: 49 },
  ];
  assert.deepEqual(aggregateCandles(samples, 10000), [{ time: 0, open: 50, high: 52, low: 49, close: 49, count: 3 }]);
});
test('keeps missing intervals empty, respects cutoff and rejects invalid prices', () => {
  assert.deepEqual(aggregateCandles([
    { id: 'a', time: 1000, price: 50 },
    { id: 'b', time: 21000, price: 48 },
    { id: 'c', time: 41000, price: 51 },
    { id: 'd', time: 42000, price: NaN },
  ], 10000, 20000).map(p => p.time), [20000, 40000]);
});
test('reserve price is token B per token A; empty reserves cannot create a price', () => {
  assert.equal(reservePrice(10_000_000n, 490_000_000n), 49);
  assert.equal(reservePrice(0n, 490_000_000n), null);
  assert.equal(reservePrice(10n, -1n), null);
  assert.equal(reservePrice(undefined, undefined), null);
});
test('a single observation is a flat candle, not an invented trading range', () => {
  assert.deepEqual(aggregateCandles([{ id: 'a', time: 1000, price: 49 }], 10000), [
    { time: 0, open: 49, high: 49, low: 49, close: 49, count: 1 },
  ]);
});
