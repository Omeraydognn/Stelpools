import { authenticate } from "./anchor";

const KEY = (address: string) => `usdc-vault:sep10:${address}`;
/** Re-authenticate this long before the token actually expires. */
const SKEW_SECONDS = 60;

interface Claims {
  sub?: string;
  exp?: number;
}

function claims(token: string): Claims | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as Claims;
  } catch {
    return null;
  }
}

function usable(token: string, address: string): boolean {
  const c = claims(token);
  if (!c) return false;
  if (c.sub && c.sub.split(":")[0] !== address) return false;
  const now = Math.floor(Date.now() / 1000);
  return typeof c.exp === "number" ? c.exp - SKEW_SECONDS > now : true;
}

function read(address: string): string | null {
  try {
    const token = sessionStorage.getItem(KEY(address));
    return token && usable(token, address) ? token : null;
  } catch {
    // Private windows and blocked storage: fall back to signing each time.
    return null;
  }
}

/** Shared across the session, so nobody is asked to re-sign mid-flow. */
const inFlight = new Map<string, Promise<string>>();

/**
 * The cached token, or null — never asks the wallet for anything.
 *
 * Anything that runs on a timer must use this. A poll that can trigger a
 * signature turns into a wallet popup every few seconds, which is exactly
 * how a background refresh becomes unusable.
 */
export function peekToken(address: string): string | null {
  return read(address);
}

/**
 * The account's SEP-10 token, signed once and reused.
 *
 * Every anchor call needs one, and obtaining it costs a wallet signature.
 * Asking again for each deposit, withdrawal and status check turned one
 * action into four popups; caching it for the tab turns it back into one.
 */
export async function getToken(address: string): Promise<string> {
  const cached = read(address);
  if (cached) return cached;

  const pending = inFlight.get(address);
  if (pending) return pending;

  const request = authenticate(address)
    .then((token) => {
      try {
        sessionStorage.setItem(KEY(address), token);
      } catch {
        // Not being able to cache only costs an extra signature later.
      }
      return token;
    })
    .finally(() => inFlight.delete(address));

  inFlight.set(address, request);
  return request;
}

/**
 * Run an anchor call with a token, and if the anchor says the session is no
 * good, throw the cached one away and try once with a fresh signature.
 *
 * A stale token otherwise fails every attempt identically, and the only way
 * out is for the user to guess that reconnecting fixes it.
 */
export async function withToken<T>(
  address: string,
  fn: (jwt: string) => Promise<T>,
): Promise<T> {
  try {
    return await fn(await getToken(address));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const expired =
      (err as { expiredSession?: boolean }).expiredSession === true || /\b401\b|\b403\b/.test(message);
    if (!expired) throw err;
    forgetToken(address);
    return fn(await getToken(address));
  }
}

export function forgetToken(address: string): void {
  try {
    sessionStorage.removeItem(KEY(address));
  } catch {
    // Nothing to clean up.
  }
}
