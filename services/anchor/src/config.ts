import { z } from "zod";

const secretKey = z.string().startsWith("S").length(56);
const publicKey = z.string().regex(/^G[A-Z2-7]{55}$/);

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(8790),
  LOG_LEVEL: z.string().default("info"),
  CORS_ORIGINS: z.string().default("http://localhost:5173,http://127.0.0.1:5173"),

  /** Where this anchor is reachable. Goes in the TOML and the SEP-10 challenge. */
  HOME_DOMAIN: z.string().min(3).default("localhost:8790"),
  PUBLIC_URL: z.string().url().default("http://localhost:8790"),

  NETWORK_PASSPHRASE: z.string().default("Test SDF Network ; September 2015"),
  HORIZON_URL: z.string().url().default("https://horizon-testnet.stellar.org"),

  /** Signs SEP-10 challenges. Holds no funds and needs no trustline. */
  SEP10_SIGNING_SECRET: secretKey,
  /** Signs the JWTs this anchor hands out. */
  JWT_SECRET: z.string().min(32),
  JWT_TTL_SECONDS: z.coerce.number().int().positive().default(86_400),

  /**
   * Issues aTRY. A deposit is a payment from here; a withdrawal is a payment
   * back to here, which burns the tokens because an asset returned to its
   * issuer ceases to exist.
   */
  ATRY_ISSUER_SECRET: secretKey,
  ATRY_CODE: z.string().min(1).max(12).default("aTRY"),

  /** The bank account a depositor actually sends lira to. */
  BANK_NAME: z.string().default("Stelpools Test Bank A.Ş."),
  BANK_IBAN: z.string().regex(/^TR\d{24}$/).default("TR000000000000000000000001"),
  BANK_ACCOUNT_HOLDER: z.string().default("Stelpools Teknoloji A.Ş."),

  /** aTRY is a receipt for lira, so the rate is 1:1 and only the fee applies. */
  FEE_BPS: z.coerce.number().int().min(0).max(500).default(0),
  MIN_DEPOSIT_TRY: z.coerce.number().positive().default(50),
  MAX_DEPOSIT_TRY: z.coerce.number().positive().default(50_000),

  /**
   * Postgres. Vercel injects POSTGRES_URL; anything compatible works.
   * The ledger is the anchor's memory, so this is not optional.
   */
  DATABASE_URL: z.string().min(10),

  /**
   * `timer` keeps a loop running and suits a host that keeps a process
   * alive. `request` does the same work, driven by the requests that care
   * about it, and is what a function host needs.
   */
  WORKER_MODE: z.enum(["timer", "request"]).default("timer"),

  /** How often the payout worker looks for work, in milliseconds. */
  WORKER_INTERVAL_MS: z.coerce.number().int().positive().default(2_000),
  /** Give up on a payout after this many failures and mark it for a human. */
  MAX_PAYOUT_ATTEMPTS: z.coerce.number().int().positive().default(8),

  /**
   * Testnet only: exposes an endpoint that pretends the bank transfer
   * arrived. It must be off anywhere real money could be involved, because
   * it mints aTRY against a transfer nobody made.
   */
  ALLOW_SIMULATED_TRANSFERS: z
    .string()
    .default("true")
    .transform((v) => v === "true" || v === "1"),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Hosts name the connection string differently; accept the common ones so
  // a managed database can be attached without editing anything.
  const withDb = {
    ...env,
    DATABASE_URL: env.DATABASE_URL ?? env.POSTGRES_URL ?? env.POSTGRES_PRISMA_URL,
  };
  const parsed = schema.safeParse(withDb);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid anchor configuration:\n${issues}`);
  }
  const cfg = parsed.data;

  // A signing key that is also the issuer would let a SEP-10 challenge be
  // replayed as a payment authorisation. Keep them apart.
  if (cfg.SEP10_SIGNING_SECRET === cfg.ATRY_ISSUER_SECRET) {
    throw new Error("SEP10_SIGNING_SECRET and ATRY_ISSUER_SECRET must be different keys");
  }
  return cfg;
}

export { publicKey };
