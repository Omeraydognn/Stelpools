import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * HS256, the subset SEP-10 needs.
 *
 * Small enough to read in one sitting, which is the point: the alternative
 * is trusting a dependency for the one thing that decides who this anchor
 * believes you are. The two rules that matter are both here — the algorithm
 * is pinned rather than read from the header (otherwise `alg: none` lets
 * anyone in), and the signature comparison is constant time.
 */
export interface Claims {
  /** The account this token speaks for. */
  sub: string;
  iss: string;
  iat: number;
  exp: number;
  jti?: string;
}

const b64url = (buf: Buffer | string): string =>
  Buffer.from(buf).toString("base64url");

function sign(input: string, secret: string): string {
  return createHmac("sha256", secret).update(input).digest("base64url");
}

export function issue(claims: Claims, secret: string): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify(claims));
  const body = `${header}.${payload}`;
  return `${body}.${sign(body, secret)}`;
}

export function verify(token: string, secret: string, now = Date.now()): Claims | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts as [string, string, string];

  // The algorithm is ours, not the token's.
  try {
    const parsed = JSON.parse(Buffer.from(header, "base64url").toString("utf8")) as {
      alg?: string;
    };
    if (parsed.alg !== "HS256") return null;
  } catch {
    return null;
  }

  const expected = sign(`${header}.${payload}`, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Claims;
    if (typeof claims.exp !== "number" || claims.exp * 1000 <= now) return null;
    if (typeof claims.sub !== "string" || !claims.sub) return null;
    return claims;
  } catch {
    return null;
  }
}

/** The Stellar account a token speaks for, stripped of any memo suffix. */
export function accountOf(claims: Claims): string {
  return claims.sub.split(":")[0] ?? claims.sub;
}
