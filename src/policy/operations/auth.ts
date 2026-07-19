/**
 * Owner / cron auth for policy operations endpoints (Lane 8-R2A).
 * OWNER_OPS_SECRET — owner status + review writes.
 * CRON_SECRET — scheduled policy operations.
 * Secrets never logged or stored in review events.
 */

export function getOwnerOpsSecret(): string | null {
  const owner = process.env.OWNER_OPS_SECRET?.trim();
  return owner || null;
}

export function getCronSecret(): string | null {
  const cron = process.env.CRON_SECRET?.trim();
  return cron || null;
}

export function extractBearerToken(req: Request): string | null {
  const header =
    req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m?.[1]?.trim() || null;
}

export function secretsEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i += 1) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return out === 0;
}

export type AuthResult =
  | { ok: true; actor: "owner" | "scheduler" }
  | { ok: false; status: 401 | 503; error: string };

/** Owner review / status write authorization. */
export function authorizeOwnerRequest(req: Request): AuthResult {
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

/** Scheduler authorization (CRON_SECRET only). */
export function authorizeCronRequest(req: Request): AuthResult {
  const expected = getCronSecret();
  if (!expected) {
    return {
      ok: false,
      status: 503,
      error: "cron_secret_not_configured",
    };
  }
  const token = extractBearerToken(req);
  if (!token || !secretsEqual(token, expected)) {
    return { ok: false, status: 401, error: "unauthorized" };
  }
  return { ok: true, actor: "scheduler" };
}

/** Status read: owner or cron secret accepted. */
export function authorizeOwnerOrCronRequest(req: Request): AuthResult {
  const owner = getOwnerOpsSecret();
  const cron = getCronSecret();
  if (!owner && !cron) {
    return {
      ok: false,
      status: 503,
      error: "owner_ops_secret_not_configured",
    };
  }
  const token = extractBearerToken(req);
  if (!token) {
    return { ok: false, status: 401, error: "unauthorized" };
  }
  if (owner && secretsEqual(token, owner)) {
    return { ok: true, actor: "owner" };
  }
  if (cron && secretsEqual(token, cron)) {
    return { ok: true, actor: "scheduler" };
  }
  return { ok: false, status: 401, error: "unauthorized" };
}
