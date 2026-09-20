import {
  Address,
  BASE_FEE,
  Contract,
  Networks,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";

import { config } from "./config";
import { t, type Key } from "./i18n";
import { signXdr } from "./wallet";

/**
 * The pool, spoken to directly.
 *
 * There is no server between this file and the contract. A swap is the
 * user's own signature on a call to `swap`, and the price it executes at is
 * whatever the reserves say at the moment it lands — which is why every
 * write here carries a floor the caller sets.
 */
export const server = new rpc.Server(config.rpcUrl);
const amm = new Contract(config.ammId);

/** Mirrors contracts/amm/src/errors.rs; the text lives in i18n as `amm.<code>`. */
const AMM_ERROR_CODES = new Set([1, 2, 3, 4, 20, 21, 22, 23, 30, 31, 32, 33, 34, 40, 50, 51, 52]);

const CHAIN_ERROR_CODES = [
  "tx_insufficient_balance",
  "op_underfunded",
  "op_no_trust",
  "tx_bad_seq",
  "tx_too_late",
] as const;

function describe(code: number | null, detail: string): string {
  if (code !== null) {
    return AMM_ERROR_CODES.has(code) ? t(`amm.${code}` as Key) : t("err.unknownCode", { code });
  }
  const hit = CHAIN_ERROR_CODES.find((c) => detail.includes(c));
  return hit ? t(`err.${hit}` as Key) : t("err.failed", { detail });
}

export class AmmError extends Error {
  readonly code: number | null;
  constructor(code: number | null, detail: string) {
    super(describe(code, detail));
    this.name = "AmmError";
    this.code = code;
  }
}

function toAmmError(detail: string): AmmError {
  const match = /Error\(Contract, #(\d+)\)/.exec(detail);
  return new AmmError(match?.[1] ? Number(match[1]) : null, detail);
}

const i128 = (v: bigint) => nativeToScVal(v, { type: "i128" });
const addr = (v: string) => nativeToScVal(v, { type: "address" });

export type Stage = "building" | "signing" | "submitting" | "confirming";

async function simulate(method: string, args: xdr.ScVal[], source: string): Promise<unknown> {
  const account = await server.getAccount(source);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase || Networks.TESTNET,
  })
    .addOperation(amm.call(method, ...args))
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw toAmmError(sim.error);
  return sim.result?.retval ? scValToNative(sim.result.retval) : null;
}

async function invoke(
  method: string,
  args: xdr.ScVal[],
  source: string,
  onStage?: (s: Stage) => void,
): Promise<{ hash: string; value: unknown }> {
  onStage?.("building");
  const account = await server.getAccount(source);
  const built = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase || Networks.TESTNET,
  })
    .addOperation(amm.call(method, ...args))
    .setTimeout(120)
    .build();

  let prepared;
  try {
    prepared = await server.prepareTransaction(built);
  } catch (err) {
    throw toAmmError(err instanceof Error ? err.message : String(err));
  }

  onStage?.("signing");
  const signed = await signXdr(prepared.toXDR(), source);

  onStage?.("submitting");
  const sent = await server.sendTransaction(
    TransactionBuilder.fromXDR(signed, config.networkPassphrase),
  );
  if (sent.status === "ERROR") throw toAmmError(JSON.stringify(sent.errorResult));

  onStage?.("confirming");
  for (let i = 0; i < 40; i++) {
    const got = await server.getTransaction(sent.hash);
    if (got.status === rpc.Api.GetTransactionStatus.SUCCESS) {
      return { hash: sent.hash, value: got.returnValue ? scValToNative(got.returnValue) : null };
    }
    if (got.status === rpc.Api.GetTransactionStatus.FAILED) {
      throw toAmmError(JSON.stringify(got.resultXdr));
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error(t("err.notConfirmed"));
}

// ------------------------------------------------------------------ state

export interface PoolState {
  /** USDC side, in stroops. */
  reserveA: bigint;
  /** aTRY side, in stroops. */
  reserveB: bigint;
  totalShares: bigint;
  /** aTRY per USDC, scaled by 1e7. The only price there is. */
  spotPrice: bigint;
  feeBps: number;
  tokenA: string;
  tokenB: string;
  symbol: string;
  /** Only meaningful with a wallet connected. */
  userShares: bigint;
  userA: bigint;
  userB: bigint;
}

/**
 * The pool's whole state, in one request.
 *
 * `Config`, `Reserves` and the LP supply all live in the contract's
 * instance storage, which is a single ledger entry, and an LP balance is
 * one more. So this is a direct read of two entries rather than five
 * simulated calls — a simulation needs a source account loaded first, which
 * made the old version ten round trips every refresh, per visitor.
 *
 * Reading raw XDR is version-sensitive in a way a contract call is not, so
 * a failure here falls back to simulating. Being slower is survivable;
 * showing nothing is not.
 */
async function readPoolFromLedger(viewer: string | null): Promise<PoolState> {
  const contract = new Address(config.ammId).toScAddress();
  const entryKey = (key: xdr.ScVal) =>
    xdr.LedgerKey.contractData(
      new xdr.LedgerKeyContractData({
        contract,
        key,
        durability: xdr.ContractDataDurability.persistent,
      }),
    );

  const keys = [entryKey(xdr.ScVal.scvLedgerKeyContractInstance())];
  if (viewer) {
    keys.push(
      entryKey(
        xdr.ScVal.scvVec([
          nativeToScVal("Balance", { type: "symbol" }),
          nativeToScVal(viewer, { type: "address" }),
        ]),
      ),
    );
  }

  const { entries } = await server.getLedgerEntries(...keys);

  // The decoded shape of a ledger entry, as far as we walk into it.
  type Slot = { key: xdr.ScVal; val: xdr.ScVal };
  type Data = { key: xdr.ScVal; val: { value?: { storage?: Slot[] } } & xdr.ScVal };

  interface PoolConfig {
    token_a: string;
    token_b: string;
    fee_bps: number;
  }
  let cfg: PoolConfig | null = null;
  let reserveA = 0n;
  let reserveB = 0n;
  let total = 0n;
  let held = 0n;

  for (const entry of entries) {
    const data = (entry.val as unknown as { value: Data }).value;
    const storage = data.val.value?.storage;

    if (storage) {
      // The instance entry: Config, Reserves and the LP supply live here.
      for (const slot of storage) {
        const name = (scValToNative(slot.key) as string[])[0];
        if (name === "Config") {
          cfg = scValToNative(slot.val) as PoolConfig;
        } else if (name === "Reserves") {
          const r = scValToNative(slot.val) as { a: bigint; b: bigint };
          reserveA = BigInt(r.a ?? 0n);
          reserveB = BigInt(r.b ?? 0n);
        } else if (name === "TotalSupply") {
          total = BigInt(scValToNative(slot.val) as bigint);
        }
      }
    } else {
      // The only other key we asked for is this viewer's LP balance.
      held = BigInt(scValToNative(data.val) as bigint);
    }
  }

  if (!cfg) throw new Error("pool instance storage not found");

  return {
    reserveA,
    reserveB,
    totalShares: total,
    spotPrice: reserveA > 0n ? (reserveB * 10_000_000n) / reserveA : 0n,
    feeBps: Number(cfg.fee_bps ?? 0),
    tokenA: String(cfg.token_a ?? ""),
    tokenB: String(cfg.token_b ?? ""),
    symbol: LP_SYMBOL,
    userShares: held,
    userA: total > 0n ? (held * reserveA) / total : 0n,
    userB: total > 0n ? (held * reserveB) / total : 0n,
  };
}

/** Fixed in the contract; there is no setter, so there is nothing to fetch. */
const LP_SYMBOL = "spLP";

export async function readPool(viewer: string): Promise<PoolState> {
  try {
    return await readPoolFromLedger(viewer);
  } catch {
    return readPoolBySimulation(viewer);
  }
}

async function readPoolBySimulation(viewer: string): Promise<PoolState> {
  const [reserves, cfg, shares, symbol, userShares] = await Promise.all([
    simulate("get_reserves", [], viewer),
    simulate("get_config", [], viewer),
    simulate("total_shares", [], viewer),
    simulate("symbol", [], viewer),
    simulate("balance", [addr(viewer)], viewer),
  ]);

  const r = reserves as { a: bigint; b: bigint } | null;
  const c = cfg as { token_a: string; token_b: string; fee_bps: number } | null;
  const held = BigInt((userShares as bigint) ?? 0n);

  const reserveA = BigInt(r?.a ?? 0n);
  const reserveB = BigInt(r?.b ?? 0n);
  const total = BigInt((shares as bigint) ?? 0n);

  // Worked out here rather than asked for: it is the same division the
  // contract does, and one fewer round trip on every refresh.
  const userA = total > 0n ? (held * reserveA) / total : 0n;
  const userB = total > 0n ? (held * reserveB) / total : 0n;

  return {
    reserveA,
    reserveB,
    totalShares: total,
    spotPrice: reserveA > 0n ? (reserveB * 10_000_000n) / reserveA : 0n,
    feeBps: Number(c?.fee_bps ?? 0),
    tokenA: String(c?.token_a ?? ""),
    tokenB: String(c?.token_b ?? ""),
    symbol: String(symbol ?? "spLP"),
    userShares: held,
    userA,
    userB,
  };
}

// ----------------------------------------------------------------- quotes

/**
 * What the pool would pay for `amountIn`, at this instant.
 *
 * Simulated against the live contract rather than recomputed here, so the
 * number on screen is the number the swap will produce — a local
 * reimplementation of the curve is one refactor away from quietly
 * disagreeing with the chain.
 */
export const quoteSwap = (tokenIn: string, amountIn: bigint, viewer: string) =>
  simulate("get_amount_out", [addr(tokenIn), i128(amountIn)], viewer) as Promise<bigint>;

/** The matching second amount for a deposit, at the pool's current ratio. */
export const quoteLiquidity = (tokenIn: string, amountIn: bigint, viewer: string) =>
  simulate("quote_liquidity", [addr(tokenIn), i128(amountIn)], viewer) as Promise<bigint>;

/** What burning these LP tokens would return. */
export const previewRemove = (shares: bigint, viewer: string) =>
  simulate("preview_remove", [i128(shares)], viewer) as Promise<[bigint, bigint]>;

/**
 * How far this trade moves the price, in basis points.
 *
 * Worth showing plainly: on a thin pool a modest trade can cost far more
 * than the fee, and that cost is invisible unless something names it.
 */
export function priceImpactBps(
  amountIn: bigint,
  amountOut: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
): number {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0;
  // What the trade would return with no slippage and no fee at all.
  const ideal = (amountIn * reserveOut) / reserveIn;
  if (ideal <= 0n) return 0;
  const lost = ideal - amountOut;
  if (lost <= 0n) return 0;
  return Number((lost * 10_000n) / ideal);
}

// ----------------------------------------------------------------- writes

/**
 * Trade one side for the other.
 *
 * `minOut` is the caller's floor, and the contract enforces it: anyone can
 * trade in the same ledger, so the quote is a forecast and this is the
 * promise.
 */
export async function swap(
  trader: string,
  tokenIn: string,
  amountIn: bigint,
  minOut: bigint,
  onStage?: (s: Stage) => void,
): Promise<{ amountOut: bigint; hash: string }> {
  const { hash, value } = await invoke(
    "swap",
    [addr(trader), addr(tokenIn), i128(amountIn), i128(minOut)],
    trader,
    onStage,
  );
  return { amountOut: BigInt((value as bigint) ?? 0n), hash };
}

export async function addLiquidity(
  provider: string,
  amountA: bigint,
  amountB: bigint,
  minA: bigint,
  minB: bigint,
  onStage?: (s: Stage) => void,
): Promise<{ usedA: bigint; usedB: bigint; shares: bigint; hash: string }> {
  const { hash, value } = await invoke(
    "add_liquidity",
    [addr(provider), i128(amountA), i128(amountB), i128(minA), i128(minB)],
    provider,
    onStage,
  );
  const [usedA, usedB, shares] = (value as [bigint, bigint, bigint]) ?? [0n, 0n, 0n];
  return { usedA: BigInt(usedA), usedB: BigInt(usedB), shares: BigInt(shares), hash };
}

export async function removeLiquidity(
  provider: string,
  shares: bigint,
  minA: bigint,
  minB: bigint,
  onStage?: (s: Stage) => void,
): Promise<{ amountA: bigint; amountB: bigint; hash: string }> {
  const { hash, value } = await invoke(
    "remove_liquidity",
    [addr(provider), i128(shares), i128(minA), i128(minB)],
    provider,
    onStage,
  );
  const [amountA, amountB] = (value as [bigint, bigint]) ?? [0n, 0n];
  return { amountA: BigInt(amountA), amountB: BigInt(amountB), hash };
}

/** Apply a slippage tolerance to a quote, as the floor to send on-chain. */
export function withTolerance(amount: bigint, toleranceBps: number): bigint {
  return (amount * BigInt(10_000 - toleranceBps)) / 10_000n;
}

export const explorerContract = () => `${config.explorer}/contract/${config.ammId}`;
export const explorerTx = (hash: string) => `${config.explorer}/tx/${hash}`;
