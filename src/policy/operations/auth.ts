/**
 * Owner / cron auth for policy operations endpoints.
 * Reuses CRON_SECRET; optional OWNER_OPS_SECRET takes precedence when set.
 */

export function getOwnerOpsSecret(): string | null {
  const owner = process.env.OWNER_OPS_SECRET?.trim();
  if (owner) return owner;
  const cron = process.env.CRON_SECRET?.trim();
  if (cron) return cron;
  return null;
}

export function extractBearerToken(req: Request): string | null {
  const header = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m?.[1]?.trim() || null;
}

/**
 * Constant-time-ish compare for secrets (length may leak; acceptable for MVP gate).
 */
export function secretsEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i += 1) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return out === 0;
}

export function authorizeOwnerRequest(req: Request): {
  ok: true;
  actor: string;
} | {
  ok: false;
  status: 401 | 503;
  error: string;
} {
  const expected = getOwnerOpsSecret();
  if (!expected) {
    return {
      ok: false,
      status: 503,
      error: "owner_ops_secret_not_configured",
    };
  }
  const token = extractBearerToken(req);
  if (!token || !secretsEqual(token, expected)) {
    return { ok: false, status: 401, error: "unauthorized" };
  }
  return { ok: true, actor: "owner" };
}
