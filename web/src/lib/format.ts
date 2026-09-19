/** 7-decimal stroops → a human USDC string. */
export function formatUsdc(stroops: string | bigint, decimals = 2): string {
  const value = Number(BigInt(stroops)) / 1e7;
  return value.toLocaleString("tr-TR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Kuruş → "1.000,00" in Turkish convention. */
export function formatTry(kurus: string | bigint | number): string {
  const value = Number(kurus) / 100;
  return value.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** "1.000,00" or "1000.50" typed by a human → kuruş. */
export function parseTryToKurus(input: string): bigint | null {
  const cleaned = input.trim().replace(/\s/g, "");
  if (!cleaned) return null;
  const normalized = /,\d{1,2}$/.test(cleaned)
    ? cleaned.replace(/\./g, "").replace(",", ".")
    : cleaned.replace(/,/g, "");
  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) return null;
  return BigInt(Math.round(value * 100));
}

/** "20,5" or "20.5" → USDC stroops. */
export function parseUsdcToStroops(input: string): bigint | null {
  const value = Number(input.trim().replace(",", "."));
  if (!Number.isFinite(value) || value <= 0) return null;
  return BigInt(Math.round(value * 1e7));
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
  if (!value.startsWith("TR")) return "IBAN TR ile başlamalı.";
  const digits = value.slice(2);
  if (!/^\d*$/.test(digits)) return "IBAN, TR'den sonra yalnızca rakam içermeli.";
  if (digits.length !== 24) {
    return `TR'den sonra 24 rakam olmalı, ${digits.length} girdiniz.`;
  }
  return null;
}

