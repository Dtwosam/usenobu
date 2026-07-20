/**
 * SQLite-backed auth store (web DB). Pure functions for unit tests.
 */
import type { NobuDatabase } from "../db/index.js";
import { newId, sha256Hex } from "./crypto.js";
import {
  ACCOUNT_ID_RE,
  AUTH_LOGIN_TOKEN_TTL_MS,
  AUTH_RATE_LIMIT_MAX,
  AUTH_RATE_LIMIT_WINDOW_MS,
  AUTH_SESSION_MAX_AGE_SECONDS,
} from "./config.js";

export type AccountRow = {
  id: string;
  email_normalized: string;
  email_verified_at: string | null;
  created_at: string;
  updated_at: string;
};

export type LoginTokenRow = {
  id: string;
  email_normalized: string;
  token_hash: string;
  expires_at: string;
  used_at: string | null;
  created_at: string;
  guest_owner_ref: string | null;
};

export type SessionRow = {
  id: string;
  account_id: string;
  token_hash: string;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
  last_seen_at: string;
};

export function newAccountId(): string {
  return newId("acct").replace(/^acct_/, "acct_");
}

/** Ensure acct_ + 32 hex form. */
export function mintAccountId(): string {
  const hex = newId("x").replace(/^x_/, "");
  return `acct_${hex.slice(0, 32).padEnd(32, "0")}`;
}

export function isAccountOwnerRef(ref: string): boolean {
  return ACCOUNT_ID_RE.test(String(ref || "").trim());
}

export function getAccountById(
  db: NobuDatabase,
  id: string,
): AccountRow | null {
  const row = db
    .prepare(`SELECT * FROM accounts WHERE id = ?`)
    .get(id) as AccountRow | undefined;
  return row ?? null;
}

export function getAccountByEmail(
  db: NobuDatabase,
  emailNormalized: string,
): AccountRow | null {
  const row = db
    .prepare(`SELECT * FROM accounts WHERE email_normalized = ?`)
    .get(emailNormalized) as AccountRow | undefined;
  return row ?? null;
}

export function upsertAccountForEmail(
  db: NobuDatabase,
  emailNormalized: string,
  nowIso: string,
): AccountRow {
  const existing = getAccountByEmail(db, emailNormalized);
  if (existing) return existing;
  const id = mintAccountId();
  db.prepare(
    `INSERT INTO accounts (id, email_normalized, email_verified_at, created_at, updated_at)
     VALUES (?,?,NULL,?,?)`,
  ).run(id, emailNormalized, nowIso, nowIso);
  return getAccountById(db, id)!;
}

export function markAccountVerified(
  db: NobuDatabase,
  accountId: string,
  nowIso: string,
): void {
  db.prepare(
    `UPDATE accounts SET email_verified_at = COALESCE(email_verified_at, ?), updated_at = ? WHERE id = ?`,
  ).run(nowIso, nowIso, accountId);
}

export function insertLoginToken(args: {
  db: NobuDatabase;
  emailNormalized: string;
  rawToken: string;
  guestOwnerRef: string | null;
  now?: Date;
  ttlMs?: number;
}): LoginTokenRow {
  const now = args.now ?? new Date();
  const nowIso = now.toISOString();
  const expires = new Date(
    now.getTime() + (args.ttlMs ?? AUTH_LOGIN_TOKEN_TTL_MS),
  ).toISOString();
  const id = newId("tok");
  const token_hash = sha256Hex(args.rawToken);
  args.db
    .prepare(
      `INSERT INTO auth_login_tokens
       (id, email_normalized, token_hash, expires_at, used_at, created_at, request_ip_hash, guest_owner_ref)
       VALUES (?,?,?,?,NULL,?,NULL,?)`,
    )
    .run(
      id,
      args.emailNormalized,
      token_hash,
      expires,
      nowIso,
      args.guestOwnerRef,
    );
  return {
    id,
    email_normalized: args.emailNormalized,
    token_hash,
    expires_at: expires,
    used_at: null,
    created_at: nowIso,
    guest_owner_ref: args.guestOwnerRef,
  };
}

export function findLoginTokenByHash(
  db: NobuDatabase,
  tokenHash: string,
): LoginTokenRow | null {
  const row = db
    .prepare(`SELECT * FROM auth_login_tokens WHERE token_hash = ?`)
    .get(tokenHash) as LoginTokenRow | undefined;
  return row ?? null;
}

export function markLoginTokenUsed(
  db: NobuDatabase,
  tokenId: string,
  nowIso: string,
): boolean {
  const r = db
    .prepare(
      `UPDATE auth_login_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL`,
    )
    .run(nowIso, tokenId);
  return Number(r.changes ?? 0) === 1;
}

export function createSession(args: {
  db: NobuDatabase;
  accountId: string;
  rawSessionToken: string;
  now?: Date;
  maxAgeSeconds?: number;
}): SessionRow {
  const now = args.now ?? new Date();
  const nowIso = now.toISOString();
  const maxAge = args.maxAgeSeconds ?? AUTH_SESSION_MAX_AGE_SECONDS;
  const expires = new Date(now.getTime() + maxAge * 1000).toISOString();
  const id = newId("sess");
  const token_hash = sha256Hex(args.rawSessionToken);
  args.db
    .prepare(
      `INSERT INTO auth_sessions
       (id, account_id, token_hash, expires_at, revoked_at, created_at, last_seen_at)
       VALUES (?,?,?,?,NULL,?,?)`,
    )
    .run(id, args.accountId, token_hash, expires, nowIso, nowIso);
  return {
    id,
    account_id: args.accountId,
    token_hash,
    expires_at: expires,
    revoked_at: null,
    created_at: nowIso,
    last_seen_at: nowIso,
  };
}

export function findSessionByTokenHash(
  db: NobuDatabase,
  tokenHash: string,
): SessionRow | null {
  const row = db
    .prepare(`SELECT * FROM auth_sessions WHERE token_hash = ?`)
    .get(tokenHash) as SessionRow | undefined;
  return row ?? null;
}

export function revokeSession(
  db: NobuDatabase,
  sessionId: string,
  nowIso: string,
): void {
  db.prepare(
    `UPDATE auth_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`,
  ).run(nowIso, sessionId);
}

export function revokeAllSessionsForAccount(
  db: NobuDatabase,
  accountId: string,
  nowIso: string,
): void {
  db.prepare(
    `UPDATE auth_sessions SET revoked_at = ? WHERE account_id = ? AND revoked_at IS NULL`,
  ).run(nowIso, accountId);
}

export function touchSession(
  db: NobuDatabase,
  sessionId: string,
  nowIso: string,
): void {
  db.prepare(`UPDATE auth_sessions SET last_seen_at = ? WHERE id = ?`).run(
    nowIso,
    sessionId,
  );
}

/**
 * Rate limit by opaque bucket (email hash preferred — never store raw email as key).
 * Returns true if allowed.
 */
export function consumeRateLimit(args: {
  db: NobuDatabase;
  bucketKey: string;
  now?: Date;
  windowMs?: number;
  maxHits?: number;
}): boolean {
  const now = args.now ?? new Date();
  const windowMs = args.windowMs ?? AUTH_RATE_LIMIT_WINDOW_MS;
  const maxHits = args.maxHits ?? AUTH_RATE_LIMIT_MAX;
  const row = args.db
    .prepare(`SELECT * FROM auth_rate_limits WHERE bucket_key = ?`)
    .get(args.bucketKey) as
    | { bucket_key: string; window_started_at: string; hit_count: number }
    | undefined;

  if (!row) {
    args.db
      .prepare(
        `INSERT INTO auth_rate_limits (bucket_key, window_started_at, hit_count) VALUES (?,?,1)`,
      )
      .run(args.bucketKey, now.toISOString());
    return true;
  }

  const started = Date.parse(row.window_started_at);
  if (!Number.isFinite(started) || now.getTime() - started > windowMs) {
    args.db
      .prepare(
        `UPDATE auth_rate_limits SET window_started_at = ?, hit_count = 1 WHERE bucket_key = ?`,
      )
      .run(now.toISOString(), args.bucketKey);
    return true;
  }

  if (row.hit_count >= maxHits) return false;
  args.db
    .prepare(
      `UPDATE auth_rate_limits SET hit_count = hit_count + 1 WHERE bucket_key = ?`,
    )
    .run(args.bucketKey);
  return true;
}

/**
 * Atomically claim guest purchases onto a verified account.
 * Only exact guest owner match; never ownerless, demo-user, or other accounts.
 */
export function claimGuestPurchasesAtomic(args: {
  db: NobuDatabase;
  guestOwnerRef: string;
  accountId: string;
  now?: Date;
}): { claimed: number; already_claimed: boolean } {
  const guest = String(args.guestOwnerRef || "").trim();
  const accountId = String(args.accountId || "").trim();
  if (!guest || !isAccountOwnerRef(accountId)) {
    return { claimed: 0, already_claimed: false };
  }
  // Refuse claiming quarantined / legacy identities as "guest"
  if (guest === "demo-user" || !guest.startsWith("usr_")) {
    return { claimed: 0, already_claimed: false };
  }

  const nowIso = (args.now ?? new Date()).toISOString();
  const claimId = newId("claim");

  args.db.exec("BEGIN IMMEDIATE");
  try {
    const prior = args.db
      .prepare(
        `SELECT purchases_claimed FROM auth_claim_events
         WHERE account_id = ? AND guest_owner_ref = ?`,
      )
      .get(accountId, guest) as { purchases_claimed: number } | undefined;

    if (prior) {
      args.db.exec("COMMIT");
      return { claimed: prior.purchases_claimed, already_claimed: true };
    }

    const countRow = args.db
      .prepare(`SELECT COUNT(*) AS c FROM purchases WHERE user_ref = ?`)
      .get(guest) as { c: number };
    const eligible = Number(countRow?.c ?? 0);

    if (eligible > 0) {
      args.db
        .prepare(
          `UPDATE purchases SET user_ref = ?, updated_at = ? WHERE user_ref = ?`,
        )
        .run(accountId, nowIso, guest);
    }

    args.db
      .prepare(
        `INSERT INTO auth_claim_events (id, account_id, guest_owner_ref, purchases_claimed, created_at)
         VALUES (?,?,?,?,?)`,
      )
      .run(claimId, accountId, guest, eligible, nowIso);

    args.db.exec("COMMIT");
    return { claimed: eligible, already_claimed: false };
  } catch (err) {
    try {
      args.db.exec("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw err;
  }
}
