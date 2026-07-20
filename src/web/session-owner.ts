/**
 * Server-assigned session owner for consumer purchase privacy (Lane 7.3A.2A).
 *
 * Identity is derived only from an httpOnly cookie the server sets.
 * Client-supplied user/owner/email fields are never trusted for ownership.
 *
 * This is not external IdP login; it is a durable browser session identity
 * so My Purchases stays account-private without a shared demo user.
 */
import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { isVercelRuntime } from "./db.js";

export const OWNER_COOKIE_NAME = "nobu_owner_v1";

/** Guest browser owners (cookie path). */
export const SESSION_OWNER_RE = /^usr_[a-f0-9]{32}$/;

/** Verified account owners (server-assigned after email magic link). */
export const ACCOUNT_OWNER_RE = /^acct_[a-f0-9]{32}$/;

/**
 * Legacy shared demo identity. Never used for new production purchases.
 * Existing rows remain in DB but are not visible to consumer sessions.
 */
export const LEGACY_SHARED_DEMO_OWNER = "demo-user";

/** @deprecated Use getOrCreateSessionOwner for production. Kept for unit/e2e fixtures. */
export const WEB_DEMO_USER_REF = LEGACY_SHARED_DEMO_OWNER;

const OWNER_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export function isValidSessionOwner(ref: string): boolean {
  return SESSION_OWNER_RE.test(String(ref || "").trim());
}

export function isValidAccountOwner(ref: string): boolean {
  return ACCOUNT_OWNER_RE.test(String(ref || "").trim());
}

/** Service-layer owner refs (guest, account, or explicit test ids). */
export function isUsableOwnerRef(ref: string): boolean {
  const t = String(ref || "").trim();
  if (!t || t.length < 4 || t.length > 80) return false;
  if (t === LEGACY_SHARED_DEMO_OWNER) return true; // tests only
  if (isValidSessionOwner(t)) return true;
  if (isValidAccountOwner(t)) return true;
  // Explicit test / seeded owners (never from production cookie minting)
  if (/^test_[a-zA-Z0-9_-]{3,64}$/.test(t)) return true;
  return false;
}

export function normalizeOwnerRef(ref: string): string | null {
  const t = String(ref || "").trim();
  if (!isUsableOwnerRef(t)) return null;
  return t;
}

/** Ownerless historical rows — never assigned to the next session. */
export function isOwnerlessUserRef(
  userRef: string | null | undefined,
): boolean {
  const t = String(userRef ?? "").trim();
  return t.length === 0;
}

/**
 * Records that must not appear in consumer lists:
 * - null/empty owner
 * - legacy shared demo-user (pre-privacy global identity)
 */
export function isQuarantinedUserRef(
  userRef: string | null | undefined,
): boolean {
  if (isOwnerlessUserRef(userRef)) return true;
  return String(userRef).trim() === LEGACY_SHARED_DEMO_OWNER;
}

/**
 * Consumer may access a purchase only when owner matches exactly.
 * Ownerless (null/empty) never matches. Missing / cross-user → not found.
 *
 * Legacy `demo-user` rows only match an explicit demo-user owner (tests).
 * Production cookies mint `usr_*` only, so legacy shared rows stay invisible
 * to real accounts without reassigning them.
 */
export function consumerOwnsPurchase(
  purchaseUserRef: string | null | undefined,
  sessionOwner: string,
): boolean {
  if (isOwnerlessUserRef(purchaseUserRef)) return false;
  const owner = normalizeOwnerRef(sessionOwner);
  if (!owner) return false;
  return String(purchaseUserRef).trim() === owner;
}

export function newSessionOwnerId(): string {
  return `usr_${randomUUID().replace(/-/g, "")}`;
}

/**
 * Read session owner without creating one.
 * Missing/invalid cookie → null (unauthenticated for consumer privacy ops).
 */
export async function getSessionOwner(): Promise<string | null> {
  try {
    const jar = await cookies();
    const raw = jar.get(OWNER_COOKIE_NAME)?.value;
    if (!raw || !isValidSessionOwner(raw)) return null;
    return raw;
  } catch {
    return null;
  }
}

/**
 * Ensure a server-assigned session owner exists (httpOnly cookie).
 *
 * Prefer middleware minting on consumer routes. Server Actions may also
 * set the cookie; Server Components can only read it.
 */
export async function getOrCreateSessionOwner(): Promise<string> {
  const existing = await getSessionOwner();
  if (existing) return existing;

  const owner = newSessionOwnerId();
  try {
    const jar = await cookies();
    // Only works in Server Actions / Route Handlers (not RSC).
    jar.set(OWNER_COOKIE_NAME, owner, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: isVercelRuntime() || process.env.NODE_ENV === "production",
      maxAge: OWNER_COOKIE_MAX_AGE,
    });
  } catch {
    // Middleware should already have set the cookie on consumer paths.
    // If both fail, return an ephemeral id for this request only (fail closed
    // for reads against durable rows; create will retry set on action).
  }
  return owner;
}

/** Redacted quarantine counts — no IDs, titles, or PII. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function countQuarantinedPurchases(db: {
  prepare: (sql: string) => { get: (...args: any[]) => any };
}): {
  ownerless: number;
  legacy_shared: number;
  total_quarantined: number;
} {
  const ownerlessRow = db
    .prepare(
      `SELECT COUNT(*) AS c FROM purchases
       WHERE user_ref IS NULL OR TRIM(user_ref) = ''`,
    )
    .get() as { c: number };
  const legacyRow = db
    .prepare(`SELECT COUNT(*) AS c FROM purchases WHERE user_ref = ?`)
    .get(LEGACY_SHARED_DEMO_OWNER) as { c: number };
  const ownerless = Number(ownerlessRow?.c ?? 0);
  const legacy_shared = Number(legacyRow?.c ?? 0);
  return {
    ownerless,
    legacy_shared,
    total_quarantined: ownerless + legacy_shared,
  };
}
