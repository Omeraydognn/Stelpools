import { Buffer } from "buffer";

import {
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
import { signXdr } from "./wallet";

export const server = new rpc.Server(config.rpcUrl);
const vault = new Contract(config.vaultId);

/** Mirrors contracts/vault/src/errors.rs. */
const VAULT_ERRORS: Record<number, string> = {
  2: "Kasa henüz kurulmamış.",
  3: "Yatırımlar geçici olarak durduruldu. Çekimler açık.",
  20: "Geçersiz tutar.",
  21: "İlk yatırım en az 1 USDC olmalı.",
  22: "Bu tutar pay üretmeyecek kadar küçük.",
  23: "Bu kadar payınız yok.",
  24: "Bu kadar pay için ödenecek tutar sıfıra yuvarlanıyor.",
  30: "Geçersiz komisyon oranı.",
  31: "Kasa mevduat tavanına ulaştı.",
  50: "Yetki (allowance) yetersiz.",
  52: "Pay bakiyeniz yetersiz.",
  60: "Kasa şu an önden ödeme yapmıyor.",
  61: "Tutar tek seferlik avans limitinin üstünde.",
  62: "Kasanın toplam avans kapasitesi dolu.",
  63: "Bu hesabın kapatılmamış bir avansı var.",
  64: "Açık bir avans yok.",
  65: "Kasada şu an yeterli likit USDC yok.",
  40: "Hesaplama hatası.",
};

const STELLAR_ERRORS: Record<string, string> = {
  tx_insufficient_balance: "Cüzdanınızda işlem ücreti için yeterli XLM yok.",
  op_underfunded: "USDC bakiyeniz bu tutar için yetersiz.",
  op_no_trust: "USDC trustline'ınız yok.",
  tx_bad_seq: "Cüzdan sırası eşleşmedi. Sayfayı yenileyin.",
  tx_too_late: "İşlem zaman aşımına uğradı.",
};

export class VaultError extends Error {
  readonly code: number | null;

  constructor(code: number | null, detail: string) {
    const known =
      code !== null
        ? (VAULT_ERRORS[code] ?? `Kasa hatası #${code}`)
        : (Object.entries(STELLAR_ERRORS).find(([c]) => detail.includes(c))?.[1] ??
          `İşlem başarısız: ${detail}`);
    super(known);
    this.name = "VaultError";
    this.code = code;
  }
}

function toVaultError(detail: string): VaultError {
  const match = /Error\(Contract, #(\d+)\)/.exec(detail);
  return new VaultError(match?.[1] ? Number(match[1]) : null, detail);
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
    .addOperation(vault.call(method, ...args))
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw toVaultError(sim.error);
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
    .addOperation(vault.call(method, ...args))
    .setTimeout(120)
    .build();

  let prepared;
  try {
    prepared = await server.prepareTransaction(built);
  } catch (err) {
    throw toVaultError(err instanceof Error ? err.message : String(err));
  }

  onStage?.("signing");
  const signed = await signXdr(prepared.toXDR(), source);

  onStage?.("submitting");
  const sent = await server.sendTransaction(
    TransactionBuilder.fromXDR(signed, config.networkPassphrase),
  );
  if (sent.status === "ERROR") throw toVaultError(JSON.stringify(sent.errorResult));

  onStage?.("confirming");
  for (let i = 0; i < 40; i++) {
    const got = await server.getTransaction(sent.hash);
    if (got.status === rpc.Api.GetTransactionStatus.SUCCESS) {
      return { hash: sent.hash, value: got.returnValue ? scValToNative(got.returnValue) : null };
    }
    if (got.status === rpc.Api.GetTransactionStatus.FAILED) {
      throw toVaultError(JSON.stringify(got.resultXdr));
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error("İşlem 40 saniyede onaylanmadı.");
}

export interface VaultState {
  totalAssets: bigint;
  /** USDC actually in hand; the rest is out on advance. */
  liquidAssets: bigint;
  totalShares: bigint;
  /** USDC per share, scaled by 1e7. */
  sharePrice: bigint;
  withdrawFeeBps: number;
  /** 0 means no limit. */
  depositCap: bigint;
  paused: boolean;
  /** SEP-41 symbol of the share token. */
  symbol: string;
  /** Principal currently out on advance. */
  totalAdvanced: bigint;
  /** Everything the contract was configured with, for the details panel. */
  admin: string;
  relay: string;
  usdc: string;
  depositCapRaw: bigint;
  maxAdvance: bigint;
  advanceCap: bigint;
  advanceFeeBps: number;
  /** Only present when a wallet is connected. */
  userShares: bigint;
  userAssets: bigint;
}

/** One round trip for everything the vault screen shows. */
export async function readVault(viewer: string): Promise<VaultState> {
  const [totalAssets, liquid, totalShares, sharePrice, cfg, userShares, symbol] =
    await Promise.all([
      simulate("total_assets", [], viewer),
      simulate("liquid_assets", [], viewer),
      simulate("total_shares", [], viewer),
      simulate("share_price", [], viewer),
      simulate("get_config", [], viewer),
      simulate("balance", [addr(viewer)], viewer),
      simulate("symbol", [], viewer),
    ]);
  const advanced = BigInt(((await simulate("total_advanced", [], viewer)) as bigint) ?? 0n);

  const shares = BigInt((userShares as bigint) ?? 0n);
  const userAssets =
    shares > 0n ? BigInt((await simulate("preview_withdraw", [i128(shares)], viewer)) as bigint) : 0n;

  const config = cfg as {
    withdraw_fee_bps: number;
    paused: boolean;
    deposit_cap: bigint;
    admin: string;
    relay: string;
    usdc: string;
    max_advance: bigint;
    advance_cap: bigint;
    advance_fee_bps: number;
  };
  return {
    totalAssets: BigInt((totalAssets as bigint) ?? 0n),
    liquidAssets: BigInt((liquid as bigint) ?? 0n),
    admin: String(config?.admin ?? ""),
    relay: String(config?.relay ?? ""),
    usdc: String(config?.usdc ?? ""),
    depositCapRaw: BigInt(config?.deposit_cap ?? 0n),
    maxAdvance: BigInt(config?.max_advance ?? 0n),
    advanceCap: BigInt(config?.advance_cap ?? 0n),
    advanceFeeBps: Number(config?.advance_fee_bps ?? 0),
    totalShares: BigInt((totalShares as bigint) ?? 0n),
    sharePrice: BigInt((sharePrice as bigint) ?? 10_000_000n),
    withdrawFeeBps: Number(config?.withdraw_fee_bps ?? 0),
    depositCap: BigInt(config?.deposit_cap ?? 0n),
    paused: Boolean(config?.paused),
    symbol: String(symbol ?? "vUSDC"),
    totalAdvanced: advanced,
    userShares: shares,
    userAssets,
  };
}

export const previewDeposit = (assets: bigint, viewer: string) =>
  simulate("preview_deposit", [i128(assets)], viewer).then((v) => BigInt((v as bigint) ?? 0n));

export const previewWithdraw = (shares: bigint, viewer: string) =>
  simulate("preview_withdraw", [i128(shares)], viewer).then((v) => BigInt((v as bigint) ?? 0n));

export async function deposit(from: string, assets: bigint, onStage?: (s: Stage) => void) {
  const { hash, value } = await invoke("deposit", [addr(from), i128(assets)], from, onStage);
  return { hash, shares: BigInt((value as bigint) ?? 0n) };
}

/** Send part of a position to another wallet — shares are a SEP-41 token. */
export async function transferShares(
  from: string,
  to: string,
  amount: bigint,
  onStage?: (s: Stage) => void,
) {
  const { hash } = await invoke("transfer", [addr(from), addr(to), i128(amount)], from, onStage);
  return { hash };
}

export async function withdraw(from: string, shares: bigint, onStage?: (s: Stage) => void) {
  const { hash, value } = await invoke("withdraw", [addr(from), i128(shares)], from, onStage);
  return { hash, assets: BigInt((value as bigint) ?? 0n) };
}

/** What this account still owes the vault for an advance, in stroops. */
export const advanceOf = (user: string, viewer: string) =>
  simulate("advance_of", [addr(user)], viewer).then((v) => BigInt((v as bigint) ?? 0n));

/** Hand an advance back. Anyone may pay; normally it is the borrower. */
export async function repayAdvance(
  from: string,
  user: string,
  amount: bigint,
  onStage?: (s: Stage) => void,
) {
  const { hash, value } = await invoke(
    "repay_advance",
    [addr(from), addr(user), i128(amount)],
    from,
    onStage,
  );
  return { hash, paid: BigInt((value as bigint) ?? 0n) };
}

export const explorerTx = (hash: string) => `${config.explorer}/tx/${hash}`;
export const explorerContract = () => `${config.explorer}/contract/${config.vaultId}`;
void Buffer;
