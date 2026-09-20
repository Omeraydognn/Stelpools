/**
 * Testnet defaults for everything.
 *
 * A missing variable used to throw while this module was being imported,
 * which happens before anything can render — the page just stayed black. The
 * app is testnet-only and every one of these values is public, so falling
 * back to the deployed vault is strictly better than showing nothing. When a
 * fallback is used the app says so rather than pretending it was configured.
 */
const DEFAULTS = {
  vaultId: "CCEAE5OSVBV63UVH26JKQ5PWXQPOHTAGL3WSDCCG2GYF23DGWM77VOV2",
  ammId: "CBX67JY3W2MRZZVT4KJKE6BQUAYME6WK6HZ74LDQP7O46QHUPWFAAZTT",
  atryIssuer: "GA6OU57WZIIU47TT56FTNMIYL574WMJ6MDHSS3ION65GTTXLTX2VPUHS",
  atryCode: "aTRY",
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
  horizonUrl: "https://horizon-testnet.stellar.org",
  anchorUrl: "http://localhost:8790",
  anchorHomeDomain: "localhost:8790",
  usdcIssuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
} as const;

/** Variables that were not set and fell back to a default. */
export const missingEnv: string[] = [];

function fromEnv<K extends keyof typeof DEFAULTS>(name: string, key: K): string {
  const value = import.meta.env[name as keyof ImportMetaEnv] as string | undefined;
  if (value) return value;
  missingEnv.push(name);
  return DEFAULTS[key];
}

export const config = {
  vaultId: fromEnv("VITE_VAULT_CONTRACT_ID", "vaultId"),
  /** The constant-product pool. Price lives here and nowhere else. */
  ammId: fromEnv("VITE_AMM_CONTRACT_ID", "ammId"),
  /** aTRY: one token, one lira held by the anchor. */
  atryIssuer: fromEnv("VITE_ATRY_ISSUER", "atryIssuer"),
  atryCode: fromEnv("VITE_ATRY_CODE", "atryCode"),
  rpcUrl: fromEnv("VITE_SOROBAN_RPC_URL", "rpcUrl"),
  networkPassphrase: fromEnv("VITE_NETWORK_PASSPHRASE", "networkPassphrase"),
  horizonUrl: fromEnv("VITE_HORIZON_URL", "horizonUrl"),
  anchorUrl: fromEnv("VITE_ANCHOR_URL", "anchorUrl").replace(/\/$/, ""),
  anchorHomeDomain: fromEnv("VITE_ANCHOR_HOME_DOMAIN", "anchorHomeDomain"),
  usdcIssuer: fromEnv("VITE_USDC_ISSUER", "usdcIssuer"),
  explorer: "https://stellar.expert/explorer/testnet",
} as const;

export const isTestnet = config.networkPassphrase.includes("Test SDF Network");

if (missingEnv.length > 0) {
  console.warn(
    `[config] Using testnet defaults for: ${missingEnv.join(", ")}. ` +
      "Set these in your .env (locally) or in the host's environment variables (when deployed).",
  );
}
