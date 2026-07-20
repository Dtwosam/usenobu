/**
 * Lane 7.4B — agent connection + conversational email verification.
 *
 * Independent of website sessions/cookies: a verified connection cannot sign
 * into the website, and a website session cannot authorize agent actions.
 * `connection_id` is a non-secret handle; `connection_token` is a secret
 * bearer credential returned exactly once and stored only as a hash.
 */
import type { NobuDatabase } from "../db/index.js";
import {
  getAuthStore,
  type AgentConnectionRow,
  type AuthStore,
} from "./auth-store.js";
import {
  isValidEmail,
  normalizeEmail,
  randomSixDigitCode,
  randomToken,
  safeEqualHex,
  sha256Hex,
} from "./crypto.js";
import { sendAgentEmailCode } from "./email.js";

/** Shorter than the magic-link TTL because it is user-typed, not clicked. */
export const AGENT_EMAIL_CODE_TTL_MS = 10 * 60 * 1000;
export const AGENT_EMAIL_CODE_MAX_ATTEMPTS = 5;
export const AGENT_EMAIL_RESEND_COOLDOWN_SECONDS = 45;
/** Matches the existing session max-age pattern. */
export const AGENT_CONNECTION_TOKEN_TTL_MS = 60 * 60 * 24 * 30 * 1000;

const AGENT_EMAIL_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const AGENT_EMAIL_RATE_LIMIT_MAX = 8;
const AGENT_SOURCE_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const AGENT_SOURCE_RATE_LIMIT_MAX = 20;

type EnvRecord = NodeJS.ProcessEnv | Record<string, string | undefined>;

async function resolveStore(
  sqliteDb?: NobuDatabase,
  env?: EnvRecord,
): Promise<AuthStore> {
  return getAuthStore({ sqliteDb, env });
}

function emailRateLimitBucket(emailNormalized: string): string {
  return `agent_email:${sha256Hex(emailNormalized).slice(0, 32)}`;
}

function sourceRateLimitBucket(sourceKey: string): string {
  return `agent_email_src:${sha256Hex(sourceKey).slice(0, 32)}`;
}

export type BeginEmailVerificationResult =
  | {
      ok: true;
      status: "EMAIL_CODE_SENT";
      connection_id: string;
      expires_at: string;
      resend_after_seconds: number;
    }
  | {
      ok: false;
      error: "invalid_email" | "rate_limited" | "not_configured" | "send_failed";
    };

/**
 * Start conversational email verification for an agent connection.
 * Never reveals whether the email already has an account — no account row
 * is touched until VERIFY_EMAIL_CODE succeeds.
 */
export async function beginAgentEmailVerification(args: {
  email: string;
  sourceKey?: string;
  now?: Date;
  env?: EnvRecord;
  sqliteDb?: NobuDatabase;
}): Promise<BeginEmailVerificationResult> {
  const env = args.env ?? process.env;
  const email = normalizeEmail(args.email);
  if (!email || !isValidEmail(args.email)) {
    return { ok: false, error: "invalid_email" };
  }

  const store = await resolveStore(args.sqliteDb, env);
  const now = args.now ?? new Date();

  if (
    !(await store.consumeRateLimit({
      bucketKey: emailRateLimitBucket(email),
      now,
      windowMs: AGENT_EMAIL_RATE_LIMIT_WINDOW_MS,
      maxHits: AGENT_EMAIL_RATE_LIMIT_MAX,
    }))
  ) {
    return { ok: false, error: "rate_limited" };
  }

  const sourceKey = String(args.sourceKey || "unknown").trim() || "unknown";
  if (
    !(await store.consumeRateLimit({
      bucketKey: sourceRateLimitBucket(sourceKey),
      now,
      windowMs: AGENT_SOURCE_RATE_LIMIT_WINDOW_MS,
      maxHits: AGENT_SOURCE_RATE_LIMIT_MAX,
    }))
  ) {
    return { ok: false, error: "rate_limited" };
  }

  const connection = await store.insertAgentConnection({
    emailNormalized: email,
    now,
  });

  const rawCode = randomSixDigitCode();
  const codeRow = await store.insertAgentEmailCode({
    connectionId: connection.id,
    emailNormalized: email,
    rawCode,
    now,
    ttlMs: AGENT_EMAIL_CODE_TTL_MS,
  });

  const sent = await sendAgentEmailCode({
    emailNormalized: email,
    connectionId: connection.id,
    rawCode,
    expiresMinutes: Math.round(AGENT_EMAIL_CODE_TTL_MS / 60000),
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
    status: "EMAIL_CODE_SENT",
    connection_id: connection.id,
    expires_at: codeRow.expires_at,
    resend_after_seconds: AGENT_EMAIL_RESEND_COOLDOWN_SECONDS,
  };
}

export type VerifyEmailCodeResult =
  | {
      ok: true;
      status: "EMAIL_VERIFIED";
      connection_id: string;
      connection_token: string;
      credential_expires_at: string;
    }
  | { ok: false; status: "CODE_INVALID" | "CODE_EXPIRED" }
  | { ok: false; error: "invalid_input" };

/**
 * Consume a six-digit code. Atomic single-use: concurrent/replayed calls for
 * the same code lose. On success, upserts+verifies the email account (never
 * a browser session/cookie), activates the connection, and mints a
 * high-entropy connection_token returned exactly once.
 */
export async function verifyAgentEmailCode(args: {
  connectionId: string;
  code: string;
  now?: Date;
  env?: EnvRecord;
  sqliteDb?: NobuDatabase;
}): Promise<VerifyEmailCodeResult> {
  const connectionId = String(args.connectionId || "").trim();
  const code = String(args.code || "").trim();
  if (!connectionId || !/^\d{6,}$/.test(code)) {
    return { ok: false, error: "invalid_input" };
  }

  const env = args.env ?? process.env;
  const store = await resolveStore(args.sqliteDb, env);
  const now = args.now ?? new Date();
  const nowIso = now.toISOString();

  const connection = await store.getAgentConnectionById(connectionId);
  if (!connection || connection.status === "revoked") {
    return { ok: false, status: "CODE_INVALID" };
  }

  const codeRow = await store.findLatestAgentEmailCode(connectionId);
  if (!codeRow || codeRow.connection_id !== connectionId) {
    return { ok: false, status: "CODE_INVALID" };
  }
  if (Date.parse(codeRow.expires_at) <= now.getTime()) {
    return { ok: false, status: "CODE_EXPIRED" };
  }
  if (codeRow.attempt_count >= AGENT_EMAIL_CODE_MAX_ATTEMPTS) {
    return { ok: false, status: "CODE_EXPIRED" };
  }

  const suppliedHash = sha256Hex(code);
  if (!safeEqualHex(suppliedHash, codeRow.code_hash)) {
    const nextCount = await store.incrementAgentEmailCodeAttempt(codeRow.id);
    if (nextCount >= AGENT_EMAIL_CODE_MAX_ATTEMPTS) {
      return { ok: false, status: "CODE_EXPIRED" };
    }
    return { ok: false, status: "CODE_INVALID" };
  }

  // Atomic one-time consume — concurrent/replayed verification loses.
  if (!(await store.markAgentEmailCodeUsed(codeRow.id, nowIso))) {
    return { ok: false, status: "CODE_INVALID" };
  }

  const account = await store.upsertAccountForEmail(
    connection.email_normalized,
    nowIso,
  );
  await store.markAccountVerified(account.id, nowIso);

  const rawToken = randomToken(32);
  const tokenHash = sha256Hex(rawToken);
  const expiresAt = new Date(
    now.getTime() + AGENT_CONNECTION_TOKEN_TTL_MS,
  ).toISOString();

  const activated = await store.setAgentConnectionCredential({
    connectionId,
    tokenHash,
    expiresAt,
    nowIso,
    accountId: account.id,
  });
  if (!activated) {
    return { ok: false, status: "CODE_INVALID" };
  }

  return {
    ok: true,
    status: "EMAIL_VERIFIED",
    connection_id: connectionId,
    connection_token: rawToken,
    credential_expires_at: expiresAt,
  };
}

/**
 * Internal rotation helper — replaces the token hash and immediately
 * invalidates the old token. Not exposed as its own agent action in this
 * lane; reused internally (VERIFY_EMAIL_CODE activation uses the same
 * store primitive) and available for a future ROTATE action.
 */
export async function rotateAgentConnectionToken(args: {
  connectionId: string;
  now?: Date;
  env?: EnvRecord;
  sqliteDb?: NobuDatabase;
}): Promise<
  | { ok: true; connection_token: string; credential_expires_at: string }
  | { ok: false }
> {
  const env = args.env ?? process.env;
  const store = await resolveStore(args.sqliteDb, env);
  const connection = await store.getAgentConnectionById(args.connectionId);
  if (!connection || connection.status !== "active") return { ok: false };

  const now = args.now ?? new Date();
  const rawToken = randomToken(32);
  const tokenHash = sha256Hex(rawToken);
  const expiresAt = new Date(
    now.getTime() + AGENT_CONNECTION_TOKEN_TTL_MS,
  ).toISOString();

  const updated = await store.setAgentConnectionCredential({
    connectionId: args.connectionId,
    tokenHash,
    expiresAt,
    nowIso: now.toISOString(),
  });
  if (!updated) return { ok: false };
  return { ok: true, connection_token: rawToken, credential_expires_at: expiresAt };
}

/**
 * Shared connection authorization helper. `connection_id` alone never
 * authorizes anything — a valid, unexpired `connection_token` matching the
 * stored hash is also required. Every failure reason (unknown, missing,
 * wrong, expired, revoked) is indistinguishable to the caller.
 */
export async function authorizeAgentConnection(args: {
  connectionId: string;
  connectionToken: string;
  now?: Date;
  env?: EnvRecord;
  sqliteDb?: NobuDatabase;
}): Promise<{ ok: true; connection: AgentConnectionRow } | { ok: false }> {
  const connectionId = String(args.connectionId || "").trim();
  const token = String(args.connectionToken || "").trim();
  if (!connectionId || !token) return { ok: false };

  const env = args.env ?? process.env;
  const store = await resolveStore(args.sqliteDb, env);
  const connection = await store.getAgentConnectionById(connectionId);
  if (!connection) return { ok: false };
  if (connection.status !== "active") return { ok: false };
  if (!connection.connection_token_hash || !connection.credential_expires_at) {
    return { ok: false };
  }

  const now = args.now ?? new Date();
  if (Date.parse(connection.credential_expires_at) <= now.getTime()) {
    return { ok: false };
  }

  const suppliedHash = sha256Hex(token);
  if (!safeEqualHex(suppliedHash, connection.connection_token_hash)) {
    return { ok: false };
  }

  await store.touchAgentConnectionLastUsed({
    connectionId,
    nowIso: now.toISOString(),
  });
  return { ok: true, connection };
}

export type RevokeConnectionResult =
  | { ok: true; status: "CONNECTION_REVOKED"; connection_id: string }
  | { ok: false; status: "ACTION_NOT_AUTHORIZED" };

/**
 * Revoke a connection. Requires valid authorization. Never deletes or stops
 * monitors already started, and never implies a refund.
 */
export async function revokeAgentConnectionAction(args: {
  connectionId: string;
  connectionToken: string;
  now?: Date;
  env?: EnvRecord;
  sqliteDb?: NobuDatabase;
}): Promise<RevokeConnectionResult> {
  const auth = await authorizeAgentConnection(args);
  if (!auth.ok) return { ok: false, status: "ACTION_NOT_AUTHORIZED" };

  const env = args.env ?? process.env;
  const store = await resolveStore(args.sqliteDb, env);
  const now = args.now ?? new Date();
  await store.revokeAgentConnection({
    connectionId: auth.connection.id,
    nowIso: now.toISOString(),
  });
  return { ok: true, status: "CONNECTION_REVOKED", connection_id: auth.connection.id };
}
