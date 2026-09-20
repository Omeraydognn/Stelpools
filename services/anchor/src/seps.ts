import { randomBytes } from "node:crypto";

import { Keypair, Networks, WebAuth } from "@stellar/stellar-sdk";

import type { Config } from "./config.js";

/** Short, unambiguous ids. No 0/O/1/I, so a human can read one off a screen. */
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

export function code(length: number): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i]! % ALPHABET.length];
  return out;
}

/** `dep_XXXXXXXX` — fits in a 28-byte memo with room to spare. */
export function depositId(): string {
  return `dep_${code(12)}`;
}

export function withdrawalId(): string {
  return `wdr_${code(12)}`;
}

/** What the bank description must say: STP-XXXX-XXXX. */
export function reference(): string {
  return `STP-${code(4)}-${code(4)}`;
}

// ------------------------------------------------------------------ SEP-1

export function stellarToml(cfg: Config, issuer: string, signing: string): string {
  return `VERSION="2.7.0"
NETWORK_PASSPHRASE="${cfg.NETWORK_PASSPHRASE}"
SIGNING_KEY="${signing}"
WEB_AUTH_ENDPOINT="${cfg.PUBLIC_URL}/auth"
TRANSFER_SERVER="${cfg.PUBLIC_URL}/sep6"
KYC_SERVER="${cfg.PUBLIC_URL}/sep12"
ACCOUNTS=["${issuer}", "${signing}"]

[DOCUMENTATION]
ORG_NAME="Stelpools Anchor (testnet)"
ORG_URL="${cfg.PUBLIC_URL}"
ORG_DESCRIPTION="Issues ${cfg.ATRY_CODE}, a Stellar token backed one-for-one by Turkish lira held against it. Testnet only; no real money moves."

[[CURRENCIES]]
code="${cfg.ATRY_CODE}"
issuer="${issuer}"
status="test"
display_decimals=2
is_asset_anchored=true
anchor_asset_type="fiat"
anchor_asset="TRY"
desc="One ${cfg.ATRY_CODE} is one Turkish lira deposited with this anchor. Deposits mint it; withdrawals return it to the issuer, which burns it."
`;
}

// ----------------------------------------------------------------- SEP-10

export interface Challenge {
  transaction: string;
  network_passphrase: string;
}

/**
 * Build the challenge with the SDK's own implementation.
 *
 * SEP-10 is the anchor's front door and the details it turns on — sequence
 * zero, the operation layout, the home-domain check — are exactly the sort
 * of thing a hand-rolled version gets subtly wrong.
 */
export function buildChallenge(cfg: Config, account: string, clientDomain?: string): Challenge {
  const signing = Keypair.fromSecret(cfg.SEP10_SIGNING_SECRET);
  const transaction = WebAuth.buildChallengeTx(
    signing,
    account,
    cfg.HOME_DOMAIN,
    300,
    cfg.NETWORK_PASSPHRASE,
    cfg.HOME_DOMAIN,
    clientDomain ?? null,
    undefined,
  );
  return { transaction, network_passphrase: cfg.NETWORK_PASSPHRASE };
}

export interface VerifiedChallenge {
  account: string;
}

/** Returns the account the signed challenge proves, or throws. */
export function verifyChallenge(cfg: Config, xdr: string): VerifiedChallenge {
  const signing = Keypair.fromSecret(cfg.SEP10_SIGNING_SECRET);
  const { clientAccountID } = WebAuth.readChallengeTx(
    xdr,
    signing.publicKey(),
    cfg.NETWORK_PASSPHRASE,
    cfg.HOME_DOMAIN,
    cfg.HOME_DOMAIN,
  );
  // Throws unless the client's own signature is on it.
  WebAuth.verifyChallengeTxSigners(
    xdr,
    signing.publicKey(),
    cfg.NETWORK_PASSPHRASE,
    [clientAccountID],
    cfg.HOME_DOMAIN,
    cfg.HOME_DOMAIN,
  );
  return { account: clientAccountID };
}

export const TESTNET = Networks.TESTNET;

// ------------------------------------------------------------------ money

/** Lira in, aTRY out. One for one, less whatever fee is configured. */
export function quoteDeposit(cfg: Config, tryAmount: number): { out: string; fee: string } {
  const fee = (tryAmount * cfg.FEE_BPS) / 10_000;
  return { out: (tryAmount - fee).toFixed(7), fee: fee.toFixed(7) };
}

/** aTRY in, lira out. Same rate, same fee. */
export function quoteWithdraw(cfg: Config, atryAmount: number): { out: string; fee: string } {
  const fee = (atryAmount * cfg.FEE_BPS) / 10_000;
  return { out: (atryAmount - fee).toFixed(2), fee: fee.toFixed(7) };
}
