/**
 * Passwordless magic-link auth service (Lane 7.3A.2A.1).
 *
 * - Guest identity remains nobu_owner_v1 (usr_*).
 * - Verified accounts use stable acct_* IDs as purchases.user_ref.
 * - Client never supplies owner or account IDs for assignment.
 */
import type { NobuDatabase } from "../db/index.js";
import {
  getAppBaseUrl,
  AUTH_LOGIN_TOKEN_TTL_MS,
  AUTH_RESEND_COOLDOWN_SECONDS,
  authManualActionsRequired,
  isAuthTestMode,
} from "./config.js";
import {
  isValidEmail,
  normalizeEmail,
  randomToken,
  sha256Hex,
  truncateEmail,
} from "./crypto.js";
import { sendMagicLinkEmail } from "./email.js";
import {
  claimGuestPurchasesAtomic,
  createSession,
  findLoginTokenByHash,
  findSessionByTokenHash,
  getAccountByEmail,
  getAccountById,
  insertLoginToken,
  isAccountOwnerRef,
  markAccountVerified,
  markLoginTokenUsed,
  revokeSession,
  touchSession,
  upsertAccountForEmail,
  consumeRateLimit,
  type AccountRow,
} from "./store.js";
import {
  clearAuthSessionCookie,
  readAuthSessionToken,
  writeAuthSessionToken,
} from "./session-cookie.js";
import {
  getOrCreateSessionOwner,
  getSessionOwner,
  isValidSessionOwner,
  newSessionOwnerId,
  OWNER_COOKIE_NAME,
} from "../web/session-owner.js";
import { isVercelRuntime } from "../web/db.js";
import { cookies } from "next/headers";

export type AuthAccountView = {
  id: string;
  email: string;
  email_display: string;
  initial: string;
};

export type RequestLoginResult =
  | { ok: true; status: "sent"; resend_after_seconds: number }
  | { ok: false; error: "invalid_email" | "rate_limited" | "not_configured" | "send_failed" };

export type VerifyLoginResult =
  | {
      ok: true;
      account_id: string;
      claimed: number;
      already_claimed: boolean;
    }
  | {
      ok: false;
      error: "invalid_token" | "expired" | "used" | "not_configured";
    };

function emailBucket(emailNormalized: string): string {
  return `login:${sha256Hex(emailNormalized).slice(0, 32)}`;
}

/**
 * Start passwordless sign-in. Always same success shape when email is valid
 * (does not reveal whether an account already exists).
 */
export async function requestMagicLinkLogin(args: {
  db: NobuDatabase;
  email: string;
  guestOwnerRef?: string | null;
  now?: Date;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
}): Promise<RequestLoginResult> {
  const env = args.env ?? process.env;
  const email = normalizeEmail(args.email);
  if (!email || !isValidEmail(args.email)) {
    return { ok: false, error: "invalid_email" };
  }

  const manual = authManualActionsRequired(env);
  if (manual.length && !isAuthTestMode(env)) {
    // Still allow test/dev paths; production without secrets fails closed here
    if (env.NODE_ENV === "production" || env.VERCEL === "1") {
      return { ok: false, error: "not_configured" };
    }
  }

  const now = args.now ?? new Date();
  if (
    !consumeRateLimit({
      db: args.db,
      bucketKey: emailBucket(email),
      now,
    })
  ) {
    return { ok: false, error: "rate_limited" };
  }

  // Upsert account row (unverified until magic link succeeds).
  upsertAccountForEmail(args.db, email, now.toISOString());

  const rawToken = randomToken(32);
  const guest =
    args.guestOwnerRef && isValidSessionOwner(args.guestOwnerRef)
      ? args.guestOwnerRef
      : null;

  insertLoginToken({
    db: args.db,
    emailNormalized: email,
    rawToken,
    guestOwnerRef: guest,
    now,
  });

  const base = getAppBaseUrl(env);
  const verifyUrl = `${base}/auth/verify?token=${encodeURIComponent(rawToken)}`;

  const sent = await sendMagicLinkEmail({
    emailNormalized: email,
    verifyUrl,
    rawToken,
    expiresMinutes: Math.round(AUTH_LOGIN_TOKEN_TTL_MS / 60000),
    env,
  });

  if (!sent.ok) {
    return {
      ok: false,
      error: sent.error === "not_configured" ? "not_configured" : "send_failed",
    };
  }

  return {
    ok: true,
    status: "sent",
    resend_after_seconds: AUTH_RESEND_COOLDOWN_SECONDS,
  };
}

/**
 * Consume one-time magic link token → verified account + session + guest claim.
 */
export function verifyMagicLinkToken(args: {
  db: NobuDatabase;
  rawToken: string;
  /** Guest cookie at verify time (server-read only). */
  guestOwnerRef?: string | null;
  now?: Date;
}): VerifyLoginResult {
  const raw = String(args.rawToken || "").trim();
  if (!raw || raw.length < 16) {
    return { ok: false, error: "invalid_token" };
  }

  const now = args.now ?? new Date();
  const nowIso = now.toISOString();
  const hash = sha256Hex(raw);
  const token = findLoginTokenByHash(args.db, hash);
  if (!token) return { ok: false, error: "invalid_token" };
  if (token.used_at) return { ok: false, error: "used" };
  if (Date.parse(token.expires_at) <= now.getTime()) {
    return { ok: false, error: "expired" };
  }

  // Mark used first (one-time) — fail closed if concurrent race loses
  if (!markLoginTokenUsed(args.db, token.id, nowIso)) {
    return { ok: false, error: "used" };
  }

  const account = upsertAccountForEmail(
    args.db,
    token.email_normalized,
    nowIso,
  );
  markAccountVerified(args.db, account.id, nowIso);

  // Prefer guest captured on token request; fall back to current cookie guest.
  const guestCandidate =
    (token.guest_owner_ref && isValidSessionOwner(token.guest_owner_ref)
      ? token.guest_owner_ref
      : null) ||
    (args.guestOwnerRef && isValidSessionOwner(args.guestOwnerRef)
      ? args.guestOwnerRef
      : null);

  let claimed = 0;
  let already_claimed = false;
  if (guestCandidate) {
    const claim = claimGuestPurchasesAtomic({
      db: args.db,
      guestOwnerRef: guestCandidate,
      accountId: account.id,
      now,
    });
    claimed = claim.claimed;
    already_claimed = claim.already_claimed;
  }

  return {
    ok: true,
    account_id: account.id,
    claimed,
    already_claimed,
  };
}

/** Create session after successful verify; returns raw session token for cookie. */
export function establishSession(args: {
  db: NobuDatabase;
  accountId: string;
  now?: Date;
}): { rawSessionToken: string; sessionId: string } {
  const rawSessionToken = randomToken(32);
  const session = createSession({
    db: args.db,
    accountId: args.accountId,
    rawSessionToken,
    now: args.now,
  });
  return { rawSessionToken, sessionId: session.id };
}

export function resolveSessionAccount(
  db: NobuDatabase,
  rawSessionToken: string | null | undefined,
  now?: Date,
): (AccountRow & { session_id: string }) | null {
  const raw = String(rawSessionToken || "").trim();
  if (!raw) return null;
  const hash = sha256Hex(raw);
  const session = findSessionByTokenHash(db, hash);
  if (!session || session.revoked_at) return null;
  const t = now ?? new Date();
  if (Date.parse(session.expires_at) <= t.getTime()) return null;
  const account = getAccountById(db, session.account_id);
  if (!account || !account.email_verified_at) return null;
  touchSession(db, session.id, t.toISOString());
  return { ...account, session_id: session.id };
}

export async function getAuthenticatedAccount(
  db: NobuDatabase,
): Promise<AuthAccountView | null> {
  const raw = await readAuthSessionToken();
  const row = resolveSessionAccount(db, raw);
  if (!row) return null;
  const email = row.email_normalized;
  return {
    id: row.id,
    email,
    email_display: truncateEmail(email),
    initial: email.charAt(0).toUpperCase() || "?",
  };
}

/**
 * Effective purchase owner for consumer ops:
 * signed-in account id, else guest usr_*.
 */
export async function getEffectivePurchaseOwner(args?: {
  db?: NobuDatabase;
  createGuestIfMissing?: boolean;
}): Promise<{
  owner_ref: string;
  kind: "account" | "guest";
  account: AuthAccountView | null;
}> {
  const db = args?.db;
  if (db) {
    const account = await getAuthenticatedAccount(db);
    if (account && isAccountOwnerRef(account.id)) {
      return { owner_ref: account.id, kind: "account", account };
    }
  }

  const guest =
    args?.createGuestIfMissing === false
      ? await getSessionOwner()
      : await getOrCreateSessionOwner();

  if (!guest) {
    return {
      owner_ref: newSessionOwnerId(),
      kind: "guest",
      account: null,
    };
  }

  return { owner_ref: guest, kind: "guest", account: null };
}

export async function rotateGuestCookie(): Promise<string> {
  const next = newSessionOwnerId();
  try {
    const jar = await cookies();
    jar.set(OWNER_COOKIE_NAME, next, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: isVercelRuntime() || process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 30,
    });
  } catch {
    /* ok */
  }
  return next;
}

export async function logoutCurrentSession(db: NobuDatabase): Promise<void> {
  const raw = await readAuthSessionToken();
  if (raw) {
    const row = resolveSessionAccount(db, raw);
    if (row) {
      revokeSession(db, row.session_id, new Date().toISOString());
    }
  }
  await clearAuthSessionCookie();
}

export async function applySessionCookie(rawSessionToken: string): Promise<void> {
  await writeAuthSessionToken(rawSessionToken);
}

export { getAccountByEmail, isAccountOwnerRef };
