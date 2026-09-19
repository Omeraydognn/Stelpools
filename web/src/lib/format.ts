import { locale, num, t } from "./i18n";

/** 7-decimal stroops → a human USDC string in the active language. */
export function formatUsdc(stroops: string | bigint, decimals = 2): string {
  return num(Number(BigInt(stroops)) / 1e7, decimals);
}

/** Minor units → a money string in the active language. */
export function formatTry(kurus: string | bigint | number): string {
  return num(Number(kurus) / 100, 2);
}

/**
 * A number a human typed, in either convention.
 *
 * "1.000", "1,000", "1 000" and "1000" all mean a thousand depending on
 * where you are, and the language toggle must not silently change what a
 * half-typed amount means. The rule: the last separator is the decimal
 * point, unless it is the only one and exactly three digits follow it, in
 * which case it groups thousands.
 */
export function parseAmount(input: string): number {
  const s = input.trim().replace(/[\s ']/g, "");
  if (!s) return 0;
  const separators = s.match(/[.,]/g) ?? [];
  let normalized = s;
  if (separators.length > 0) {
    const cut = Math.max(s.lastIndexOf(","), s.lastIndexOf("."));
    const whole = s.slice(0, cut).replace(/[.,]/g, "");
    const fraction = s.slice(cut + 1);
    normalized =
      separators.length === 1 && fraction.length === 3 ? whole + fraction : `${whole}.${fraction}`;
  }
  const value = Number(normalized);
  return Number.isFinite(value) ? value : 0;
}

/** A typed amount → minor units. */
export function parseTryToKurus(input: string): bigint | null {
  const value = parseAmount(input);
  if (!Number.isFinite(value) || value < 0) return null;
  return BigInt(Math.round(value * 100));
}

/** A typed amount → USDC stroops. */
export function parseUsdcToStroops(input: string): bigint | null {
  const value = parseAmount(input);
  if (!Number.isFinite(value) || value <= 0) return null;
  return BigInt(Math.round(value * 1e7));
}

/** A thousand, written the way the active language writes it. */
export function defaultTryAmount(): string {
  return (1000).toLocaleString(locale(), { maximumFractionDigits: 0 });
}

export function truncateAddress(address: string, chars = 4): string {
  if (address.length <= chars * 2 + 3) return address;
  return `${address.slice(0, chars)}…${address.slice(-chars)}`;
}

export function normalizeIban(iban: string): string {
  return iban.replace(/[\s-]/g, "").toUpperCase();
}

export function formatIban(iban: string): string {
  return normalizeIban(iban).replace(/(.{4})/g, "$1 ").trim();
}

/** Turkish IBANs are TR + 24 digits — the same rule the anchor applies. */
export function isValidIban(iban: string): boolean {
  return /^TR\d{24}$/.test(normalizeIban(iban));
}

/** Why an IBAN was rejected, so the field can say more than "invalid". */
export function ibanProblem(iban: string): string | null {
  const value = normalizeIban(iban);
  if (!value) return null;
  if (!value.startsWith("TR")) return t("iban.mustStartTr");
  const digits = value.slice(2);
  if (!/^\d*$/.test(digits)) return t("iban.digitsOnly");
  if (digits.length !== 24) return t("iban.wrongLength", { n: digits.length });
  return null;
}
