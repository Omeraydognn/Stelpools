const required = (name: string, value: string | undefined): string => {
  if (!value) throw new Error(`Missing ${name}. Copy .env.example to .env.`);
  return value;
};

export const config = {
  vaultId: required("VITE_VAULT_CONTRACT_ID", import.meta.env.VITE_VAULT_CONTRACT_ID),
  rpcUrl: import.meta.env.VITE_SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org",
  networkPassphrase:
    import.meta.env.VITE_NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015",
  horizonUrl: import.meta.env.VITE_HORIZON_URL ?? "https://horizon-testnet.stellar.org",
  /** Optional: the advance relay. Without it, instant fills are hidden. */
  relayUrl: (import.meta.env.VITE_RELAY_URL ?? "").replace(/\/$/, ""),
  anchorUrl: (import.meta.env.VITE_ANCHOR_URL ?? "https://tr-mock-anchor.fly.dev").replace(/\/$/, ""),
  anchorHomeDomain: import.meta.env.VITE_ANCHOR_HOME_DOMAIN ?? "tr-mock-anchor.fly.dev",
  usdcIssuer:
    import.meta.env.VITE_USDC_ISSUER ?? "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  explorer: "https://stellar.expert/explorer/testnet",
} as const;

export const isTestnet = config.networkPassphrase.includes("Test SDF Network");
