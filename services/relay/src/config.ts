import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(8788),
  LOG_LEVEL: z.string().default("info"),
  CORS_ORIGINS: z.string().default("http://localhost:5173,http://127.0.0.1:5173"),

  NETWORK_PASSPHRASE: z.string().default("Test SDF Network ; September 2015"),
  SOROBAN_RPC_URL: z.string().url().default("https://soroban-testnet.stellar.org"),
  VAULT_CONTRACT_ID: z.string().startsWith("C").length(56),
  RELAY_SECRET_KEY: z.string().startsWith("S").length(56),

  ANCHOR_URL: z.string().url().default("https://tr-mock-anchor.fly.dev"),
  MAX_ADVANCE_USDC: z.coerce.number().positive().default(100),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid relay configuration:\n${issues}`);
  }
  return parsed.data;
}
