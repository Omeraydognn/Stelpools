import { scValToNative } from "@stellar/stellar-sdk";

import { config } from "./config";
import { server } from "./vault";

export interface PricePoint {
  ledger: number;
  at: Date;
  /** USDC per share, scaled by 1e7. */
  sharePrice: bigint;
  totalAssets: bigint;
  event: string;
}

export type VaultEventKind =
  | "deposited"
  | "withdrawn"
  | "donated"
  | "advanced"
  | "repaid"
  | "written_off";

export interface VaultEvent {
  kind: VaultEventKind;
  at: Date;
  ledger: number;
  txHash: string;
  /** The account the event is about, when it names one. */
  account: string | null;
  /** USDC the event moved, in stroops. */
  assets: bigint;
  /** Fee the vault kept or expects, in stroops. */
  fee: bigint;
  /** Shares minted or burned, when the event involves any. */
  shares: bigint;
  /** For `repaid`: what is still owed afterwards. */
  remaining: bigint;
}

export interface VaultTotals {
  /** Deposits plus withdrawals, in stroops — the pool's turnover. */
  volume: bigint;
  depositVolume: bigint;
  withdrawVolume: bigint;
  /** Exit fees, which are earned the moment they are taken. */
  withdrawFees: bigint;
  /** Advance fees on advances seen to be fully repaid. */
  advanceFees: bigint;
  /** Losses written off. */
  writtenOff: bigint;
  advancesOpened: number;
}

export interface Position {
  /** Deposits minus withdrawals, in stroops, over the observed window. */
  netContributed: bigint;
  deposited: bigint;
  withdrawn: bigint;
  /** True when the window contains at least one of this account's deposits. */
  observed: boolean;
}

export interface VaultHistory {
  points: PricePoint[];
  events: VaultEvent[];
  totals: VaultTotals;
  /** Annualised from the first and last point, or null if too little data. */
  aprPercent: number | null;
  /** How far back the series reaches. */
  windowHours: number | null;
}

/** Events that move the share price, and so define the curve. */
const EVENTS = new Set(["deposited", "withdrawn", "donated"]);

/** Everything worth listing in the activity feed. */
const TRACKED = new Set([
  "deposited",
  "withdrawn",
  "donated",
  "advanced",
  "repaid",
  "written_off",
]);

/** The RPC scans a bounded slice of ledgers per call, so we page forward. */
const PAGE_LEDGERS = 8_000;
const MAX_PAGES = 6;

async function fetchEvents(lookbackLedgers: number) {
  const health = await server.getHealth();
  const latest = health.latestLedger;
  const oldest = health.oldestLedger ?? 1;
  let cursor: string | undefined;
  let startLedger = Math.max(oldest, latest - lookbackLedgers);
  const all: Awaited<ReturnType<typeof server.getEvents>>["events"] = [];
  const filters = [{ type: "contract" as const, contractIds: [config.vaultId] }];

  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await server.getEvents(
      cursor ? { cursor, filters, limit: 200 } : { startLedger, filters, limit: 200 },
    );
    all.push(...res.events);
    // A page that reached the head, or returned nothing new, ends the walk.
    // Stop once the walk has reached the head of the chain.
    if (!res.cursor) break;
    if (res.events.length === 0 && startLedger + PAGE_LEDGERS >= latest) break;
    cursor = res.cursor;
    startLedger += PAGE_LEDGERS;
  }
  return all;
}

/**
 * Rebuild the share-price curve from the vault's own events.
 *
 * Every event carries the totals at the moment it happened, so the series
 * needs no indexer. The RPC only serves a window of recent ledgers and scans
 * it in pages, so this is a recent history rather than the vault's whole
 * life — the UI says as much.
 */
export async function readHistory(lookbackLedgers = 40_000): Promise<VaultHistory> {
  const events = await fetchEvents(lookbackLedgers);

  const points: PricePoint[] = [];
  const decoded: VaultEvent[] = [];

  for (const raw of events) {
    let name: string;
    let data: Record<string, unknown>;
    let topics: unknown[];
    try {
      topics = raw.topic.map((t) => scValToNative(t));
      name = String(topics[0]);
      data = scValToNative(raw.value) as Record<string, unknown>;
    } catch {
      continue;
    }

    if (TRACKED.has(name)) {
      const big = (key: string) =>
        data[key] === undefined ? 0n : BigInt(data[key] as bigint);
      decoded.push({
        kind: name as VaultEventKind,
        at: new Date(raw.ledgerClosedAt),
        ledger: raw.ledger,
        txHash: raw.txHash,
        account: typeof topics[1] === "string" ? topics[1] : null,
        assets: big("assets") || big("paid_out") || big("amount"),
        fee: big("fee"),
        shares: big("shares"),
        remaining: big("remaining"),
      });
    }

    if (!EVENTS.has(name)) continue;

    const totalAssets = BigInt((data.total_assets as bigint) ?? 0n);
    // `donated` carries no share count; carry the previous one forward.
    const totalShares =
      data.total_shares !== undefined
        ? BigInt(data.total_shares as bigint)
        : (points.at(-1)?.sharePrice
            ? (totalAssets * 10_000_000n) / points.at(-1)!.sharePrice
            : 0n);
    if (totalShares <= 0n) continue;

    points.push({
      ledger: raw.ledger,
      at: new Date(raw.ledgerClosedAt),
      sharePrice: (totalAssets * 10_000_000n) / totalShares,
      totalAssets,
      event: name,
    });
  }

  const first = points[0];
  const last = points.at(-1);
  let aprPercent: number | null = null;
  let windowHours: number | null = null;

  if (first && last && last !== first && first.sharePrice > 0n) {
    const hours = (last.at.getTime() - first.at.getTime()) / 3_600_000;
    windowHours = hours;
    const growth = Number(last.sharePrice - first.sharePrice) / Number(first.sharePrice);
    // Extrapolating hours to a year is noisy on a demo vault; only show it
    // once there is at least an hour of history behind the number.
    if (hours >= 1) aprPercent = (growth / hours) * 24 * 365 * 100;
  }

  return {
    points,
    events: [...decoded].reverse(), // newest first for the feed
    totals: tally(decoded),
    aprPercent,
    windowHours,
  };
}

/**
 * Roll the events up into pool statistics.
 *
 * Advance fees are only counted once an advance is seen to be fully repaid —
 * until then the vault has earned nothing, and counting it early would be the
 * same double-count the contract itself was fixed for.
 */
function tally(events: VaultEvent[]): VaultTotals {
  const pendingFee = new Map<string, bigint>();
  const totals: VaultTotals = {
    volume: 0n,
    depositVolume: 0n,
    withdrawVolume: 0n,
    withdrawFees: 0n,
    advanceFees: 0n,
    writtenOff: 0n,
    advancesOpened: 0,
  };

  for (const e of events) {
    switch (e.kind) {
      case "deposited":
        totals.depositVolume += e.assets;
        break;
      case "withdrawn":
        totals.withdrawVolume += e.assets;
        totals.withdrawFees += e.fee;
        break;
      case "advanced":
        totals.advancesOpened += 1;
        if (e.account) pendingFee.set(e.account, e.fee);
        break;
      case "repaid":
        if (e.remaining === 0n && e.account) {
          totals.advanceFees += pendingFee.get(e.account) ?? 0n;
          pendingFee.delete(e.account);
        }
        break;
      case "written_off":
        totals.writtenOff += e.assets;
        if (e.account) pendingFee.delete(e.account);
        break;
      default:
        break;
    }
  }

  totals.volume = totals.depositVolume + totals.withdrawVolume;
  return totals;
}

/**
 * What this account put in and took out over the observed window.
 *
 * The RPC only serves recent ledgers, so a deposit older than that window is
 * invisible here — `observed` says whether the figure can be trusted as a
 * cost basis.
 */
export function positionFor(events: VaultEvent[], account: string): Position {
  let deposited = 0n;
  let withdrawn = 0n;
  for (const e of events) {
    if (e.account !== account) continue;
    if (e.kind === "deposited") deposited += e.assets;
    if (e.kind === "withdrawn") withdrawn += e.assets;
  }
  return {
    deposited,
    withdrawn,
    netContributed: deposited - withdrawn,
    observed: deposited > 0n,
  };
}
