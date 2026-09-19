import {
  BASE_FEE,
  Contract,
  Keypair,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
} from "@stellar/stellar-sdk";

import type { Config } from "./config.js";

/** Mirrors contracts/vault/src/errors.rs for the codes the relay can hit. */
const ERRORS: Record<number, string> = {
  60: "advances are switched off on the vault",
  61: "over the vault's per-advance limit",
  62: "the vault's total advance cap is full",
  63: "this account already has an advance open",
  65: "the vault does not hold enough spendable USDC",
};

export class VaultCallError extends Error {
  constructor(readonly code: number | null, detail: string) {
    super(code !== null ? (ERRORS[code] ?? `vault error #${code}`) : detail);
    this.name = "VaultCallError";
  }
}

const parseCode = (detail: string): number | null => {
  const m = /Error\(Contract, #(\d+)\)/.exec(detail);
  return m?.[1] ? Number(m[1]) : null;
};

export class VaultClient {
  private readonly server: rpc.Server;
  private readonly contract: Contract;
  private readonly keypair: Keypair;

  constructor(private readonly cfg: Config) {
    this.server = new rpc.Server(cfg.SOROBAN_RPC_URL);
    this.contract = new Contract(cfg.VAULT_CONTRACT_ID);
    this.keypair = Keypair.fromSecret(cfg.RELAY_SECRET_KEY);
  }

  get address(): string {
    return this.keypair.publicKey();
  }

  private async call(
    method: string,
    args: ReturnType<typeof nativeToScVal>[],
    write: boolean,
  ): Promise<unknown> {
    const account = await this.server.getAccount(this.keypair.publicKey());
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.cfg.NETWORK_PASSPHRASE,
    })
      .addOperation(this.contract.call(method, ...args))
      .setTimeout(60)
      .build();

    if (!write) {
      const sim = await this.server.simulateTransaction(tx);
      if (rpc.Api.isSimulationError(sim)) throw new VaultCallError(parseCode(sim.error), sim.error);
      return sim.result?.retval ? scValToNative(sim.result.retval) : null;
    }

    let prepared;
    try {
      prepared = await this.server.prepareTransaction(tx);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new VaultCallError(parseCode(detail), detail);
    }
    prepared.sign(this.keypair);

    const sent = await this.server.sendTransaction(prepared);
    if (sent.status === "ERROR") {
      throw new VaultCallError(parseCode(JSON.stringify(sent.errorResult)), "submission rejected");
    }
    for (let i = 0; i < 30; i++) {
      const got = await this.server.getTransaction(sent.hash);
      if (got.status === rpc.Api.GetTransactionStatus.SUCCESS) {
        return { hash: sent.hash, value: got.returnValue ? scValToNative(got.returnValue) : null };
      }
      if (got.status === rpc.Api.GetTransactionStatus.FAILED) {
        throw new VaultCallError(parseCode(JSON.stringify(got.resultXdr)), "failed on chain");
      }
      await new Promise((r) => setTimeout(r, 1_000));
    }
    throw new Error(`${method} not confirmed in 30s`);
  }

  openAdvance(user: string, amountStroops: bigint) {
    return this.call(
      "open_advance",
      [nativeToScVal(user, { type: "address" }), nativeToScVal(amountStroops, { type: "i128" })],
      true,
    ) as Promise<{ hash: string; value: bigint }>;
  }

  advanceOf(user: string) {
    return this.call("advance_of", [nativeToScVal(user, { type: "address" })], false) as Promise<bigint>;
  }

  liquidAssets() {
    return this.call("liquid_assets", [], false) as Promise<bigint>;
  }

  totalAdvanced() {
    return this.call("total_advanced", [], false) as Promise<bigint>;
  }
}
