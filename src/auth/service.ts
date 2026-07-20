/**
 * Passwordless magic-link auth (Lane 7.3A.2A.1R).
 *
 * Durable tokens/sessions in AuthStore (Postgres prod / SQLite tests).
 * GET only peeks; POST consumes. Never store auth rows in browser cookies.
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
  durableDbManualActions,
  getAuthStore,
  isAccountOwnerRef,
  type AuthStore,
  type AccountRow,
} from "./auth-store.js";
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
import {
  exportPurchaseBlob,
  importPurchaseBlobs,
  reassignGuestPurchasesLocally,
} from "./purchase-blobs.js";

export type AuthAccountView = {
  id: string;
  email: string;
  email_display: string;
  initial: string;
};

export type RequestLoginResult =
  | { ok: true; status: "sent"; resend_after_seconds: number }
  | {
      ok: false;
      error:
        | "invalid_email"
        | "rate_limited"
        | "not_configured"
        | "send_failed";
    };

export type PeekTokenResult =
  | { ok: true; email_hint: string }
  | { ok: false; error: "invalid_token" | "expired" | "used" };

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

async function resolveStore(sqliteDb?: NobuDatabase): Promise<AuthStore> {
  return getAuthStore({ sqliteDb });
}

/**
 * Start passwordless sign-in. Always same success shape when email is valid.
 */
export async function requestMagicLinkLogin(args: {
  email: string;
  guestOwnerRef?: string | null;
  now?: Date;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  sqliteDb?: NobuDatabase;
}): Promise<RequestLoginResult> {
  const env = args.env ?? process.env;
  const email = normalizeEmail(args.email);
  if (!email || !isValidEmail(args.email)) {
    return { ok: false, error: "invalid_email" };
  }

  const missing = [
    ...authManualActionsRequired(env),
    ...durableDbManualActions(env),
  ];
  if (missing.length && !isAuthTestMode(env)) {
    if (env.NODE_ENV === "production" || env.VERCEL === "1") {
      return { ok: false, error: "not_configured" };
    }
  }

  const store = await resolveStore(args.sqliteDb);
  const now = args.now ?? new Date();
  if (
    !(await store.consumeRateLimit({
      bucketKey: emailBucket(email),
      now,
    }))
  ) {
    return { ok: false, error: "rate_limited" };
  }

  await store.upsertAccountForEmail(email, now.toISOString());

  const rawToken = randomToken(32);
  const guest =
    args.guestOwnerRef && isValidSessionOwner(args.guestOwnerRef)
      ? args.guestOwnerRef
      : null;

  await store.insertLoginToken({
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
 * Peek token for GET confirmation page — never marks used.
 */
export async function peekMagicLinkToken(args: {
  rawToken: string;
  now?: Date;
  sqliteDb?: NobuDatabase;
}): Promise<PeekTokenResult> {
  const raw = String(args.rawToken || "").trim();
  if (!raw || raw.length < 16) {
    return { ok: false, error: "invalid_token" };
  }
  const store = await resolveStore(args.sqliteDb);
  const token = await store.findLoginTokenByHash(sha256Hex(raw));
  if (!token) return { ok: false, error: "invalid_token" };
  if (token.used_at) return { ok: false, error: "used" };
  const now = args.now ?? new Date();
  if (Date.parse(token.expires_at) <= now.getTime()) {
    return { ok: false, error: "expired" };
  }
  const email = token.email_normalized;
  const at = email.indexOf("@");
  const hint =
    at > 1
      ? `${email[0]}…${email.slice(at)}`
      : truncateEmail(email, 20);
  return { ok: true, email_hint: hint };
}

/**
 * Consume one-time magic link (POST only).
 */
export async function verifyMagicLinkToken(args: {
  rawToken: string;
  guestOwnerRef?: string | null;
  now?: Date;
  /** Local purchase DB for claim + blob export */
  purchaseDb?: NobuDatabase;
  sqliteDb?: NobuDatabase;
}): Promise<VerifyLoginResult> {
  const raw = String(args.rawToken || "").trim();
  if (!raw || raw.length < 16) {
    return { ok: false, error: "invalid_token" };
  }

  const store = await resolveStore(args.sqliteDb ?? args.purchaseDb);
  const now = args.now ?? new Date();
  const nowIso = now.toISOString();
  const hash = sha256Hex(raw);
  const token = await store.findLoginTokenByHash(hash);
  if (!token) return { ok: false, error: "invalid_token" };
  if (token.used_at) return { ok: false, error: "used" };
  if (Date.parse(token.expires_at) <= now.getTime()) {
    return { ok: false, error: "expired" };
  }

  // Consume first (one-time) — concurrent POST loses
  if (!(await store.markLoginTokenUsed(token.id, nowIso))) {
    return { ok: false, error: "used" };
  }

  const account = await store.upsertAccountForEmail(
    token.email_normalized,
    nowIso,
  );
  await store.markAccountVerified(account.id, nowIso);

  const guestCandidate =
    (token.guest_owner_ref && isValidSessionOwner(token.guest_owner_ref)
      ? token.guest_owner_ref
      : null) ||
    (args.guestOwnerRef && isValidSessionOwner(args.guestOwnerRef)
      ? args.guestOwnerRef
      : null);

  let claimed = 0;
  let already_claimed = false;

  if (guestCandidate && args.purchaseDb) {
    // Local reassignment first (idempotent when guest already empty).
    const local = reassignGuestPurchasesLocally({
      db: args.purchaseDb,
      guestOwnerRef: guestCandidate,
      accountId: account.id,
      nowIso,
    });
    const claimRecord = await store.recordClaimEvent({
      accountId: account.id,
      guestOwnerRef: guestCandidate,
      purchasesClaimed: local.claimed,
      nowIso,
    });
    already_claimed = claimRecord.already;
    claimed = claimRecord.already ? claimRecord.claimed : local.claimed;

    for (const purchaseId of local.purchaseIds) {
      const blob = exportPurchaseBlob(args.purchaseDb, purchaseId);
      if (blob) {
        await store.savePurchaseBlob({
          accountId: account.id,
          purchaseId,
          blobJson: blob,
          nowIso,
        });
      }
    }
  }

  return {
    ok: true,
    account_id: account.id,
    claimed,
    already_claimed,
  };
}

export async function establishSession(args: {
  accountId: string;
  now?: Date;
  sqliteDb?: NobuDatabase;
}): Promise<{ rawSessionToken: string; sessionId: string }> {
  const store = await resolveStore(args.sqliteDb);
  const rawSessionToken = randomToken(32);
  const session = await store.createSession({
    accountId: args.accountId,
    rawSessionToken,
    now: args.now,
  });
  return { rawSessionToken, sessionId: session.id };
}

export async function resolveSessionAccount(
  rawSessionToken: string | null | undefined,
  now?: Date,
  sqliteDb?: NobuDatabase,
): Promise<(AccountRow & { session_id: string }) | null> {
  const raw = String(rawSessionToken || "").trim();
  if (!raw) return null;
  const store = await resolveStore(sqliteDb);
  const session = await store.findSessionByTokenHash(sha256Hex(raw));
  if (!session || session.revoked_at) return null;
  const t = now ?? new Date();
  if (Date.parse(session.expires_at) <= t.getTime()) return null;
  const account = await store.getAccountById(session.account_id);
  if (!account || !account.email_verified_at) return null;
  await store.touchSession(session.id, t.toISOString());
  return { ...account, session_id: session.id };
}

export async function getAuthenticatedAccount(
  sqliteDb?: NobuDatabase,
): Promise<AuthAccountView | null> {
  const raw = await readAuthSessionToken();
  const row = await resolveSessionAccount(raw, undefined, sqliteDb);
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
 * Effective purchase owner: account when signed in, else guest.
 * Hydrates durable account purchase blobs into the local purchase DB when signed in.
 */
export async function getEffectivePurchaseOwner(args?: {
  db?: NobuDatabase;
  createGuestIfMissing?: boolean;
}): Promise<{
  owner_ref: string;
  kind: "account" | "guest";
  account: AuthAccountView | null;
}> {
  const account = await getAuthenticatedAccount(args?.db);
  if (account && isAccountOwnerRef(account.id)) {
    if (args?.db) {
      try {
        const store = await resolveStore(args.db);
        const blobs = await store.listPurchaseBlobs(account.id);
        importPurchaseBlobs(args.db, blobs);
      } catch (err) {
        console.error("nobu_account_blob_hydrate_failed", {
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return { owner_ref: account.id, kind: "account", account };
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

export async function logoutCurrentSession(
  sqliteDb?: NobuDatabase,
): Promise<void> {
  const raw = await readAuthSessionToken();
  if (raw) {
    const row = await resolveSessionAccount(raw, undefined, sqliteDb);
    if (row) {
      const store = await resolveStore(sqliteDb);
      await store.revokeSession(row.session_id, new Date().toISOString());
    }
  }
  await clearAuthSessionCookie();
}

export async function applySessionCookie(
  rawSessionToken: string,
): Promise<void> {
  await writeAuthSessionToken(rawSessionToken);
}

export { isAccountOwnerRef };

/** Persist account purchase after mutation when signed in. */
export async function persistAccountPurchaseIfNeeded(args: {
  purchaseDb: NobuDatabase;
  purchaseId: string;
  ownerRef: string;
}): Promise<void> {
  if (!isAccountOwnerRef(args.ownerRef)) return;
  const blob = exportPurchaseBlob(args.purchaseDb, args.purchaseId);
  if (!blob) return;
  const store = await resolveStore(args.purchaseDb);
  await store.savePurchaseBlob({
    accountId: args.ownerRef,
    purchaseId: args.purchaseId,
    blobJson: blob,
    nowIso: new Date().toISOString(),
  });
}
