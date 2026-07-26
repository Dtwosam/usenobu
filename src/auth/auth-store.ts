/**
 * Durable auth store interface + Postgres / SQLite adapters.
 *
 * Production: PostgreSQL via DATABASE_URL or POLICY_OPS_DATABASE_URL.
 * Tests/local without Postgres: SQLite web DB (not cookie snapshot).
 */
import pg from "pg";
import type { NobuDatabase } from "../db/index.js";
import {
  AUTH_DURABLE_SCHEMA_PATCHES,
  AUTH_DURABLE_SCHEMA_SQL,
} from "./durable-schema.js";
import {
  ACCOUNT_ID_RE,
  AUTH_LOGIN_TOKEN_TTL_MS,
  AUTH_RATE_LIMIT_MAX,
  AUTH_RATE_LIMIT_WINDOW_MS,
  AUTH_SESSION_MAX_AGE_SECONDS,
  isAuthTestMode,
} from "./config.js";
import { newId, sha256Hex } from "./crypto.js";

const { Pool } = pg;

/**
 * True for a UNIQUE-constraint conflict (SQLite message shape or Postgres
 * error code 23505). Used by recordSettledPaymentAndActivation to treat a
 * concurrent settlement race as "someone else already recorded this" rather
 * than a hard failure — the post-transaction read then resolves the true
 * outcome from durable state.
 */
function isUniqueViolationError(err: unknown): boolean {
  const anyErr = err as { code?: string; message?: string } | null;
  if (!anyErr) return false;
  if (anyErr.code === "23505") return true;
  return typeof anyErr.message === "string" && /UNIQUE constraint failed/i.test(anyErr.message);
}

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

export type AgentConnectionRow = {
  id: string;
  account_id: string | null;
  email_normalized: string;
  connection_token_hash: string | null;
  credential_expires_at: string | null;
  credential_rotated_at: string | null;
  status: string;
  revoked_at: string | null;
  created_at: string;
  last_used_at: string | null;
};

export type AgentEmailCodeRow = {
  id: string;
  connection_id: string;
  email_normalized: string;
  code_hash: string;
  expires_at: string;
  attempt_count: number;
  used_at: string | null;
  created_at: string;
};

export type DiscoverySessionRow = {
  id: string;
  structured_snapshot_json: string;
  purchase_text_hash: string | null;
  candidates_snapshot_json: string | null;
  selected_candidate_id: string | null;
  locked_fingerprint_snapshot_json: string | null;
  status: string;
  materialized_purchase_id: string | null;
  created_at: string;
  expires_at: string;
};

export type MonitoringEnrollmentQuoteRow = {
  id: string;
  connection_id: string;
  account_id: string;
  purchase_id: string;
  fingerprint_id: string;
  price_amount: number;
  price_currency: string;
  settlement_asset: string | null;
  settlement_network: string | null;
  monitoring_deadline: string | null;
  consent_monitoring_at: string;
  consent_email_alerts_at: string;
  status: string;
  expires_at: string;
  created_at: string;
};

export type PaymentAttemptRow = {
  id: string;
  quote_id: string;
  x402_challenge_ref: string | null;
  status: string;
  settlement_ref: string | null;
  created_at: string;
  settled_at: string | null;
};

export type MonitorActivationRow = {
  id: string;
  quote_id: string;
  activation_key: string;
  payment_attempt_id: string;
  purchase_id: string;
  fingerprint_id: string;
  monitor_id: string;
  status: string;
  created_at: string;
  projected_at: string | null;
  /** Lane 8R.3B — set when a Monitoring Pass authorized this activation. */
  monitoring_pass_id?: string | null;
};

/** Lane 8R.3B — an in-flight or completed Monitoring Pass payment. */
export type MonitoringPassPaymentRow = {
  id: string;
  authorization_digest: string;
  status: string;
  settlement_ref: string | null;
  created_at: string;
  updated_at: string;
};

/** Lane 8R.3B — one issued Monitoring Pass. */
export type MonitoringPassRow = {
  id: string;
  pass_token_hash: string;
  settlement_ref: string;
  payment_id: string;
  price_amount: number;
  price_currency: string;
  status: string;
  redeemed_at: string | null;
  redeemed_quote_id: string | null;
  redeemed_purchase_id: string | null;
  created_at: string;
  updated_at: string;
};

export type PurchaseBlobRow = {
  purchase_id: string;
  account_id: string;
  blob_json: string;
  updated_at: string;
  archived_at: string | null;
  user_outcome: string | null;
  user_outcome_at: string | null;
  /** Lane 7.3B — purchase-level email alert consent (0/1). */
  email_alerts_enabled?: number | null;
  email_alerts_consent_at?: string | null;
  email_alerts_disabled_at?: string | null;
};

export interface AuthStore {
  kind: "postgres" | "sqlite";
  ensureSchema(): Promise<void>;
  getAccountById(id: string): Promise<AccountRow | null>;
  getAccountByEmail(emailNormalized: string): Promise<AccountRow | null>;
  upsertAccountForEmail(
    emailNormalized: string,
    nowIso: string,
  ): Promise<AccountRow>;
  markAccountVerified(accountId: string, nowIso: string): Promise<void>;
  insertLoginToken(args: {
    emailNormalized: string;
    rawToken: string;
    guestOwnerRef: string | null;
    now?: Date;
    ttlMs?: number;
  }): Promise<LoginTokenRow>;
  /** Peek only — never marks used (safe for GET preview). */
  findLoginTokenByHash(tokenHash: string): Promise<LoginTokenRow | null>;
  /** Atomic one-time consume. Returns false if already used/missing. */
  markLoginTokenUsed(tokenId: string, nowIso: string): Promise<boolean>;
  createSession(args: {
    accountId: string;
    rawSessionToken: string;
    now?: Date;
    maxAgeSeconds?: number;
  }): Promise<SessionRow>;
  findSessionByTokenHash(tokenHash: string): Promise<SessionRow | null>;
  revokeSession(sessionId: string, nowIso: string): Promise<void>;
  touchSession(sessionId: string, nowIso: string): Promise<void>;
  consumeRateLimit(args: {
    bucketKey: string;
    now?: Date;
    windowMs?: number;
    maxHits?: number;
  }): Promise<boolean>;
  recordClaimEvent(args: {
    accountId: string;
    guestOwnerRef: string;
    purchasesClaimed: number;
    nowIso: string;
  }): Promise<{ already: boolean; claimed: number }>;
  savePurchaseBlob(args: {
    accountId: string;
    purchaseId: string;
    blobJson: string;
    nowIso: string;
    /** Preserve existing lifecycle meta unless provided */
    archived_at?: string | null;
    user_outcome?: string | null;
    user_outcome_at?: string | null;
  }): Promise<void>;
  listPurchaseBlobs(accountId: string): Promise<PurchaseBlobRow[]>;
  getPurchaseBlob(
    accountId: string,
    purchaseId: string,
  ): Promise<PurchaseBlobRow | null>;
  updatePurchaseLifecycleMeta(args: {
    accountId: string;
    purchaseId: string;
    archived_at?: string | null;
    user_outcome?: string | null;
    user_outcome_at?: string | null;
    email_alerts_enabled?: number | null;
    email_alerts_consent_at?: string | null;
    email_alerts_disabled_at?: string | null;
    nowIso: string;
  }): Promise<boolean>;
  deletePurchaseBlob(args: {
    accountId: string;
    purchaseId: string;
  }): Promise<boolean>;

  // --- Lane 7.4B: agent connections + conversational email verification ---
  insertAgentConnection(args: {
    emailNormalized: string;
    now?: Date;
  }): Promise<AgentConnectionRow>;
  getAgentConnectionById(id: string): Promise<AgentConnectionRow | null>;
  /** Activation and rotation are the same primitive: replace the credential. */
  setAgentConnectionCredential(args: {
    connectionId: string;
    tokenHash: string;
    expiresAt: string;
    nowIso: string;
    accountId?: string;
  }): Promise<boolean>;
  revokeAgentConnection(args: {
    connectionId: string;
    nowIso: string;
  }): Promise<boolean>;
  touchAgentConnectionLastUsed(args: {
    connectionId: string;
    nowIso: string;
  }): Promise<void>;
  insertAgentEmailCode(args: {
    connectionId: string;
    emailNormalized: string;
    rawCode: string;
    now?: Date;
    ttlMs?: number;
  }): Promise<AgentEmailCodeRow>;
  /** Latest not-yet-used challenge for a connection (may be expired/attempt-exhausted). */
  findLatestAgentEmailCode(
    connectionId: string,
  ): Promise<AgentEmailCodeRow | null>;
  /** Atomic one-time consume. Returns false if already used/missing. */
  markAgentEmailCodeUsed(codeId: string, nowIso: string): Promise<boolean>;
  /** Returns the attempt count after incrementing. */
  incrementAgentEmailCodeAttempt(codeId: string): Promise<number>;

  // --- Lane 7.4C: discovery sessions + monitoring enrollment quotes ---
  insertDiscoverySession(args: {
    structuredSnapshotJson: string;
    purchaseTextHash: string | null;
    candidatesSnapshotJson: string;
    now?: Date;
    ttlMs?: number;
  }): Promise<DiscoverySessionRow>;
  getDiscoverySessionById(id: string): Promise<DiscoverySessionRow | null>;
  /** Atomic: only succeeds from 'discovering' or 'confirmed'. */
  confirmDiscoverySession(args: {
    sessionId: string;
    selectedCandidateId: string;
    lockedFingerprintSnapshotJson: string;
  }): Promise<boolean>;
  /** Atomic reservation: only succeeds from 'confirmed'. First caller wins. */
  reserveDiscoverySessionMaterialization(args: {
    sessionId: string;
    purchaseId: string;
  }): Promise<boolean>;

  insertMonitoringEnrollmentQuote(args: {
    connectionId: string;
    accountId: string;
    purchaseId: string;
    fingerprintId: string;
    priceAmount: number;
    priceCurrency: string;
    monitoringDeadline: string | null;
    consentMonitoringAt: string;
    consentEmailAlertsAt: string;
    now?: Date;
    ttlMs?: number;
  }): Promise<MonitoringEnrollmentQuoteRow>;
  /** Active (status='issued', unexpired as of nowIso) quote for a purchase, if any. */
  getActiveMonitoringEnrollmentQuote(
    purchaseId: string,
    nowIso: string,
  ): Promise<MonitoringEnrollmentQuoteRow | null>;
  getMonitoringEnrollmentQuoteById(
    quoteId: string,
  ): Promise<MonitoringEnrollmentQuoteRow | null>;

  // --- Lane 7.4D: payment attempts + monitor activations ---
  /** Reuses the latest non-terminal challenge for a quote when present. */
  getLatestPaymentAttemptForQuote(
    quoteId: string,
  ): Promise<PaymentAttemptRow | null>;
  insertPaymentAttempt(args: {
    quoteId: string;
    challengeRef: string;
    now?: Date;
  }): Promise<PaymentAttemptRow>;
  /**
   * Lane 8R.0 — store opaque pending settlement tx hash only.
   * status becomes 'verifying' (awaiting official settle/status).
   */
  markPaymentAttemptVerifying(args: {
    attemptId: string;
    settlementRef: string;
    nowIso: string;
  }): Promise<boolean>;
  getMonitorActivationByQuoteId(
    quoteId: string,
  ): Promise<MonitorActivationRow | null>;
  /**
   * The Lane 7.4D durable saga step 1 — one atomic transaction within this
   * store only (never spans the separate purchases database): marks the
   * payment attempt settled, consumes the quote (only if still 'issued'),
   * and inserts exactly one monitor_activations row (status
   * 'pending_projection'). Idempotent: a concurrent/duplicate call that
   * loses the race returns the winner's existing row rather than erroring.
   */
  recordSettledPaymentAndActivation(args: {
    paymentAttemptId: string;
    quoteId: string;
    settlementRef: string;
    activationId: string;
    activationKey: string;
    purchaseId: string;
    fingerprintId: string;
    nowIso: string;
  }): Promise<
    | { outcome: "recorded" | "already_existed"; activation: MonitorActivationRow }
    | { outcome: "quote_not_issued" }
  >;
  /** Idempotent — only transitions pending_projection -> active. */
  markMonitorActivationActive(args: {
    activationId: string;
    nowIso: string;
  }): Promise<boolean>;
  /** For reconciliation — every activation still awaiting projection. */
  listPendingProjectionActivations(): Promise<MonitorActivationRow[]>;

  // --- Lane 8R.3B: Nobu Monitoring Pass ---
  /**
   * Resolves an in-flight or completed payment by the sha256 digest of the
   * replayed authorization header. The raw header is never stored — the
   * digest exists only so a repeated replay of the same signed payment
   * resolves to the same record instead of settling twice.
   */
  getMonitoringPassPaymentByDigest(
    authorizationDigest: string,
  ): Promise<MonitoringPassPaymentRow | null>;
  /** Insert-or-return: a concurrent duplicate returns the winner's row. */
  upsertMonitoringPassPayment(args: {
    id: string;
    authorizationDigest: string;
    nowIso: string;
  }): Promise<MonitoringPassPaymentRow>;
  updateMonitoringPassPayment(args: {
    id: string;
    status: "verifying" | "settled" | "failed";
    settlementRef: string | null;
    nowIso: string;
  }): Promise<boolean>;
  /**
   * Payments still awaiting official settle/status confirmation. Each row
   * already holds an opaque settlement_ref (pending tx hash). Reconciliation
   * polls that reference only — never re-verifies a signed payment header.
   */
  listVerifyingMonitoringPassPayments(): Promise<MonitoringPassPaymentRow[]>;
  /**
   * Settled payments that never received a Monitoring Pass (crash between
   * mark-settled and issue). Recovery issues from the stored settlement_ref
   * alone — no second charge, no signed-header replay.
   */
  listSettledMonitoringPassPaymentsWithoutPass(): Promise<
    MonitoringPassPaymentRow[]
  >;
  getMonitoringPassBySettlementRef(
    settlementRef: string,
  ): Promise<MonitoringPassRow | null>;
  getMonitoringPassById(passId: string): Promise<MonitoringPassRow | null>;
  /**
   * Exactly one pass per verified settlement (UNIQUE settlement_ref). A
   * duplicate or concurrent replay of the same settlement returns the
   * existing pass rather than issuing a second one.
   */
  issueMonitoringPass(args: {
    id: string;
    passTokenHash: string;
    settlementRef: string;
    paymentId: string;
    priceAmount: number;
    priceCurrency: string;
    nowIso: string;
  }): Promise<{
    outcome: "issued" | "already_existed";
    pass: MonitoringPassRow;
  }>;
  /**
   * One atomic transaction inside this store: consume the pass (only if
   * still 'issued'), consume the quote (only if still 'issued'), and insert
   * exactly one monitor_activations row. Any failure leaves the pass
   * unconsumed. Mirrors recordSettledPaymentAndActivation's race handling.
   */
  redeemMonitoringPassAndActivate(args: {
    passId: string;
    quoteId: string;
    activationId: string;
    activationKey: string;
    purchaseId: string;
    fingerprintId: string;
    nowIso: string;
  }): Promise<
    | { outcome: "recorded" | "already_existed"; activation: MonitorActivationRow }
    | { outcome: "pass_not_redeemable" }
    | { outcome: "quote_not_issued" }
  >;
  /**
   * Lane 7.4F — active agent-originated monitors for scheduler hydrate.
   * Bounded; ordered oldest-first for fairness.
   */
  listActiveMonitorActivations(args?: {
    limit?: number;
  }): Promise<MonitorActivationRow[]>;
  /** Purchase blob by id only (purchase_id is primary key). */
  getPurchaseBlobByPurchaseId(
    purchaseId: string,
  ): Promise<PurchaseBlobRow | null>;
}

export function mintAccountId(): string {
  const hex = newId("x").replace(/^x_/, "");
  return `acct_${hex.slice(0, 32).padEnd(32, "0")}`;
}

export function isAccountOwnerRef(ref: string): boolean {
  return ACCOUNT_ID_RE.test(String(ref || "").trim());
}

function resolveDatabaseUrl(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): string | null {
  return (
    env.AUTH_DATABASE_URL?.trim() ||
    env.DATABASE_URL?.trim() ||
    env.POLICY_OPS_DATABASE_URL?.trim() ||
    env.POSTGRES_URL?.trim() ||
    null
  );
}

export function hasDurableDatabaseUrl(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): boolean {
  return Boolean(resolveDatabaseUrl(env));
}

// --- SQLite adapter (tests / local without Postgres) ---

export function createSqliteAuthStore(db: NobuDatabase): AuthStore {
  return {
    kind: "sqlite",
    async ensureSchema() {
      db.exec(AUTH_DURABLE_SCHEMA_SQL);
      for (const patch of AUTH_DURABLE_SCHEMA_PATCHES) {
        try {
          db.exec(patch);
        } catch {
          /* column may already exist */
        }
      }
      // Legacy 0006 table names → mirror into durable names if present
      try {
        db.exec(`
          INSERT OR IGNORE INTO auth_accounts (id, email_normalized, email_verified_at, created_at, updated_at)
          SELECT id, email_normalized, email_verified_at, created_at, updated_at FROM accounts;
        `);
      } catch {
        /* legacy table may not exist */
      }
    },
    async getAccountById(id) {
      return (
        (db
          .prepare(`SELECT * FROM auth_accounts WHERE id = ?`)
          .get(id) as AccountRow | undefined) ?? null
      );
    },
    async getAccountByEmail(emailNormalized) {
      return (
        (db
          .prepare(`SELECT * FROM auth_accounts WHERE email_normalized = ?`)
          .get(emailNormalized) as AccountRow | undefined) ?? null
      );
    },
    async upsertAccountForEmail(emailNormalized, nowIso) {
      const existing = await this.getAccountByEmail(emailNormalized);
      if (existing) {
        // Keep legacy 0006 `accounts` row in sync for optional FKs
        try {
          db.prepare(
            `INSERT OR IGNORE INTO accounts (id, email_normalized, email_verified_at, created_at, updated_at)
             VALUES (?,?,?,?,?)`,
          ).run(
            existing.id,
            existing.email_normalized,
            existing.email_verified_at,
            existing.created_at,
            existing.updated_at,
          );
        } catch {
          /* legacy table may differ */
        }
        return existing;
      }
      const id = mintAccountId();
      db.prepare(
        `INSERT INTO auth_accounts (id, email_normalized, email_verified_at, created_at, updated_at)
         VALUES (?,?,NULL,?,?)`,
      ).run(id, emailNormalized, nowIso, nowIso);
      try {
        db.prepare(
          `INSERT OR IGNORE INTO accounts (id, email_normalized, email_verified_at, created_at, updated_at)
           VALUES (?,?,NULL,?,?)`,
        ).run(id, emailNormalized, nowIso, nowIso);
      } catch {
        /* ignore */
      }
      return (await this.getAccountById(id))!;
    },
    async markAccountVerified(accountId, nowIso) {
      db.prepare(
        `UPDATE auth_accounts SET email_verified_at = COALESCE(email_verified_at, ?), updated_at = ? WHERE id = ?`,
      ).run(nowIso, nowIso, accountId);
      try {
        db.prepare(
          `UPDATE accounts SET email_verified_at = COALESCE(email_verified_at, ?), updated_at = ? WHERE id = ?`,
        ).run(nowIso, nowIso, accountId);
      } catch {
        /* ignore */
      }
    },
    async insertLoginToken(args) {
      const now = args.now ?? new Date();
      const nowIso = now.toISOString();
      const expires = new Date(
        now.getTime() + (args.ttlMs ?? AUTH_LOGIN_TOKEN_TTL_MS),
      ).toISOString();
      const id = newId("tok");
      const token_hash = sha256Hex(args.rawToken);
      db.prepare(
        `INSERT INTO auth_login_tokens
         (id, email_normalized, token_hash, expires_at, used_at, created_at, request_ip_hash, guest_owner_ref)
         VALUES (?,?,?,?,NULL,?,NULL,?)`,
      ).run(
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
    },
    async findLoginTokenByHash(tokenHash) {
      return (
        (db
          .prepare(`SELECT * FROM auth_login_tokens WHERE token_hash = ?`)
          .get(tokenHash) as LoginTokenRow | undefined) ?? null
      );
    },
    async markLoginTokenUsed(tokenId, nowIso) {
      const r = db
        .prepare(
          `UPDATE auth_login_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL`,
        )
        .run(nowIso, tokenId);
      return Number(r.changes ?? 0) === 1;
    },
    async createSession(args) {
      const now = args.now ?? new Date();
      const nowIso = now.toISOString();
      const maxAge = args.maxAgeSeconds ?? AUTH_SESSION_MAX_AGE_SECONDS;
      const expires = new Date(now.getTime() + maxAge * 1000).toISOString();
      const id = newId("sess");
      const token_hash = sha256Hex(args.rawSessionToken);
      db.prepare(
        `INSERT INTO auth_sessions
         (id, account_id, token_hash, expires_at, revoked_at, created_at, last_seen_at)
         VALUES (?,?,?,?,NULL,?,?)`,
      ).run(id, args.accountId, token_hash, expires, nowIso, nowIso);
      return {
        id,
        account_id: args.accountId,
        token_hash,
        expires_at: expires,
        revoked_at: null,
        created_at: nowIso,
        last_seen_at: nowIso,
      };
    },
    async findSessionByTokenHash(tokenHash) {
      return (
        (db
          .prepare(`SELECT * FROM auth_sessions WHERE token_hash = ?`)
          .get(tokenHash) as SessionRow | undefined) ?? null
      );
    },
    async revokeSession(sessionId, nowIso) {
      db.prepare(
        `UPDATE auth_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`,
      ).run(nowIso, sessionId);
    },
    async touchSession(sessionId, nowIso) {
      db.prepare(
        `UPDATE auth_sessions SET last_seen_at = ? WHERE id = ?`,
      ).run(nowIso, sessionId);
    },
    async consumeRateLimit(args) {
      const now = args.now ?? new Date();
      const windowMs = args.windowMs ?? AUTH_RATE_LIMIT_WINDOW_MS;
      const maxHits = args.maxHits ?? AUTH_RATE_LIMIT_MAX;
      const row = db
        .prepare(`SELECT * FROM auth_rate_limits WHERE bucket_key = ?`)
        .get(args.bucketKey) as
        | { window_started_at: string; hit_count: number }
        | undefined;
      if (!row) {
        db.prepare(
          `INSERT INTO auth_rate_limits (bucket_key, window_started_at, hit_count) VALUES (?,?,1)`,
        ).run(args.bucketKey, now.toISOString());
        return true;
      }
      const started = Date.parse(row.window_started_at);
      if (!Number.isFinite(started) || now.getTime() - started > windowMs) {
        db.prepare(
          `UPDATE auth_rate_limits SET window_started_at = ?, hit_count = 1 WHERE bucket_key = ?`,
        ).run(now.toISOString(), args.bucketKey);
        return true;
      }
      if (row.hit_count >= maxHits) return false;
      db.prepare(
        `UPDATE auth_rate_limits SET hit_count = hit_count + 1 WHERE bucket_key = ?`,
      ).run(args.bucketKey);
      return true;
    },
    async recordClaimEvent(args) {
      const prior = db
        .prepare(
          `SELECT purchases_claimed FROM auth_claim_events
           WHERE account_id = ? AND guest_owner_ref = ?`,
        )
        .get(args.accountId, args.guestOwnerRef) as
        | { purchases_claimed: number }
        | undefined;
      if (prior) {
        return { already: true, claimed: prior.purchases_claimed };
      }
      db.prepare(
        `INSERT INTO auth_claim_events (id, account_id, guest_owner_ref, purchases_claimed, created_at)
         VALUES (?,?,?,?,?)`,
      ).run(
        newId("claim"),
        args.accountId,
        args.guestOwnerRef,
        args.purchasesClaimed,
        args.nowIso,
      );
      return { already: false, claimed: args.purchasesClaimed };
    },
    async savePurchaseBlob(args) {
      const existing = db
        .prepare(
          `SELECT archived_at, user_outcome, user_outcome_at,
                  email_alerts_enabled, email_alerts_consent_at, email_alerts_disabled_at
           FROM account_purchase_blobs WHERE purchase_id = ?`,
        )
        .get(args.purchaseId) as
        | {
            archived_at: string | null;
            user_outcome: string | null;
            user_outcome_at: string | null;
            email_alerts_enabled: number | null;
            email_alerts_consent_at: string | null;
            email_alerts_disabled_at: string | null;
          }
        | undefined;
      const archived =
        args.archived_at !== undefined
          ? args.archived_at
          : (existing?.archived_at ?? null);
      const outcome =
        args.user_outcome !== undefined
          ? args.user_outcome
          : (existing?.user_outcome ?? null);
      const outcomeAt =
        args.user_outcome_at !== undefined
          ? args.user_outcome_at
          : (existing?.user_outcome_at ?? null);
      const emailOn =
        existing?.email_alerts_enabled ?? 0;
      const emailConsent = existing?.email_alerts_consent_at ?? null;
      const emailDisabled = existing?.email_alerts_disabled_at ?? null;
      db.prepare(
        `INSERT INTO account_purchase_blobs
         (purchase_id, account_id, blob_json, updated_at, archived_at, user_outcome, user_outcome_at,
          email_alerts_enabled, email_alerts_consent_at, email_alerts_disabled_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(purchase_id) DO UPDATE SET
           account_id = excluded.account_id,
           blob_json = excluded.blob_json,
           updated_at = excluded.updated_at,
           archived_at = excluded.archived_at,
           user_outcome = excluded.user_outcome,
           user_outcome_at = excluded.user_outcome_at,
           email_alerts_enabled = COALESCE(account_purchase_blobs.email_alerts_enabled, excluded.email_alerts_enabled),
           email_alerts_consent_at = COALESCE(account_purchase_blobs.email_alerts_consent_at, excluded.email_alerts_consent_at),
           email_alerts_disabled_at = COALESCE(account_purchase_blobs.email_alerts_disabled_at, excluded.email_alerts_disabled_at)`,
      ).run(
        args.purchaseId,
        args.accountId,
        args.blobJson,
        args.nowIso,
        archived,
        outcome,
        outcomeAt,
        emailOn,
        emailConsent,
        emailDisabled,
      );
    },
    async listPurchaseBlobs(accountId) {
      return db
        .prepare(
          `SELECT * FROM account_purchase_blobs WHERE account_id = ? ORDER BY updated_at DESC`,
        )
        .all(accountId) as PurchaseBlobRow[];
    },
    async getPurchaseBlob(accountId, purchaseId) {
      return (
        (db
          .prepare(
            `SELECT * FROM account_purchase_blobs WHERE account_id = ? AND purchase_id = ?`,
          )
          .get(accountId, purchaseId) as PurchaseBlobRow | undefined) ?? null
      );
    },
    async updatePurchaseLifecycleMeta(args) {
      const row = await this.getPurchaseBlob(args.accountId, args.purchaseId);
      if (!row) return false;
      const archived =
        args.archived_at !== undefined ? args.archived_at : row.archived_at;
      const outcome =
        args.user_outcome !== undefined ? args.user_outcome : row.user_outcome;
      const outcomeAt =
        args.user_outcome_at !== undefined
          ? args.user_outcome_at
          : row.user_outcome_at;
      const emailOn =
        args.email_alerts_enabled !== undefined
          ? args.email_alerts_enabled
          : (row.email_alerts_enabled ?? 0);
      const emailConsent =
        args.email_alerts_consent_at !== undefined
          ? args.email_alerts_consent_at
          : (row.email_alerts_consent_at ?? null);
      const emailDisabled =
        args.email_alerts_disabled_at !== undefined
          ? args.email_alerts_disabled_at
          : (row.email_alerts_disabled_at ?? null);
      db.prepare(
        `UPDATE account_purchase_blobs
         SET archived_at = ?, user_outcome = ?, user_outcome_at = ?,
             email_alerts_enabled = ?, email_alerts_consent_at = ?,
             email_alerts_disabled_at = ?, updated_at = ?
         WHERE account_id = ? AND purchase_id = ?`,
      ).run(
        archived,
        outcome,
        outcomeAt,
        emailOn,
        emailConsent,
        emailDisabled,
        args.nowIso,
        args.accountId,
        args.purchaseId,
      );
      return true;
    },
    async deletePurchaseBlob(args) {
      const r = db
        .prepare(
          `DELETE FROM account_purchase_blobs WHERE account_id = ? AND purchase_id = ?`,
        )
        .run(args.accountId, args.purchaseId);
      return Number(r.changes ?? 0) > 0;
    },

    async insertAgentConnection(args) {
      const now = args.now ?? new Date();
      const nowIso = now.toISOString();
      const id = newId("conn");
      db.prepare(
        `INSERT INTO agent_connections
         (id, account_id, email_normalized, connection_token_hash, credential_expires_at,
          credential_rotated_at, status, revoked_at, created_at, last_used_at)
         VALUES (?,NULL,?,NULL,NULL,NULL,'pending',NULL,?,NULL)`,
      ).run(id, args.emailNormalized, nowIso);
      return (await this.getAgentConnectionById(id))!;
    },
    async getAgentConnectionById(id) {
      return (
        (db
          .prepare(`SELECT * FROM agent_connections WHERE id = ?`)
          .get(id) as AgentConnectionRow | undefined) ?? null
      );
    },
    async setAgentConnectionCredential(args) {
      const r = db
        .prepare(
          `UPDATE agent_connections
           SET connection_token_hash = ?,
               credential_expires_at = ?,
               credential_rotated_at = ?,
               status = 'active',
               account_id = COALESCE(?, account_id)
           WHERE id = ? AND status != 'revoked'`,
        )
        .run(
          args.tokenHash,
          args.expiresAt,
          args.nowIso,
          args.accountId ?? null,
          args.connectionId,
        );
      return Number(r.changes ?? 0) === 1;
    },
    async revokeAgentConnection(args) {
      const r = db
        .prepare(
          `UPDATE agent_connections
           SET status = 'revoked', revoked_at = ?, connection_token_hash = NULL
           WHERE id = ? AND status != 'revoked'`,
        )
        .run(args.nowIso, args.connectionId);
      return Number(r.changes ?? 0) === 1;
    },
    async touchAgentConnectionLastUsed(args) {
      db.prepare(
        `UPDATE agent_connections SET last_used_at = ? WHERE id = ?`,
      ).run(args.nowIso, args.connectionId);
    },
    async insertAgentEmailCode(args) {
      const now = args.now ?? new Date();
      const nowIso = now.toISOString();
      const expires = new Date(
        now.getTime() + (args.ttlMs ?? 10 * 60 * 1000),
      ).toISOString();
      const id = newId("aec");
      const code_hash = sha256Hex(args.rawCode);
      db.prepare(
        `INSERT INTO agent_email_codes
         (id, connection_id, email_normalized, code_hash, expires_at, attempt_count, used_at, created_at)
         VALUES (?,?,?,?,?,0,NULL,?)`,
      ).run(id, args.connectionId, args.emailNormalized, code_hash, expires, nowIso);
      return {
        id,
        connection_id: args.connectionId,
        email_normalized: args.emailNormalized,
        code_hash,
        expires_at: expires,
        attempt_count: 0,
        used_at: null,
        created_at: nowIso,
      };
    },
    async findLatestAgentEmailCode(connectionId) {
      return (
        (db
          .prepare(
            `SELECT * FROM agent_email_codes
             WHERE connection_id = ? AND used_at IS NULL
             ORDER BY created_at DESC LIMIT 1`,
          )
          .get(connectionId) as AgentEmailCodeRow | undefined) ?? null
      );
    },
    async markAgentEmailCodeUsed(codeId, nowIso) {
      const r = db
        .prepare(
          `UPDATE agent_email_codes SET used_at = ? WHERE id = ? AND used_at IS NULL`,
        )
        .run(nowIso, codeId);
      return Number(r.changes ?? 0) === 1;
    },
    async incrementAgentEmailCodeAttempt(codeId) {
      db.prepare(
        `UPDATE agent_email_codes SET attempt_count = attempt_count + 1 WHERE id = ?`,
      ).run(codeId);
      const row = db
        .prepare(`SELECT attempt_count FROM agent_email_codes WHERE id = ?`)
        .get(codeId) as { attempt_count: number } | undefined;
      return row?.attempt_count ?? 0;
    },

    async insertDiscoverySession(args) {
      const now = args.now ?? new Date();
      const nowIso = now.toISOString();
      const expires = new Date(
        now.getTime() + (args.ttlMs ?? 30 * 60 * 1000),
      ).toISOString();
      const id = newId("disc");
      db.prepare(
        `INSERT INTO discovery_sessions
         (id, structured_snapshot_json, purchase_text_hash, candidates_snapshot_json,
          selected_candidate_id, locked_fingerprint_snapshot_json, status,
          materialized_purchase_id, created_at, expires_at)
         VALUES (?,?,?,?,NULL,NULL,'discovering',NULL,?,?)`,
      ).run(
        id,
        args.structuredSnapshotJson,
        args.purchaseTextHash,
        args.candidatesSnapshotJson,
        nowIso,
        expires,
      );
      return (await this.getDiscoverySessionById(id))!;
    },
    async getDiscoverySessionById(id) {
      return (
        (db
          .prepare(`SELECT * FROM discovery_sessions WHERE id = ?`)
          .get(id) as DiscoverySessionRow | undefined) ?? null
      );
    },
    async confirmDiscoverySession(args) {
      const r = db
        .prepare(
          `UPDATE discovery_sessions
           SET selected_candidate_id = ?, locked_fingerprint_snapshot_json = ?, status = 'confirmed'
           WHERE id = ? AND status IN ('discovering', 'confirmed')`,
        )
        .run(
          args.selectedCandidateId,
          args.lockedFingerprintSnapshotJson,
          args.sessionId,
        );
      return Number(r.changes ?? 0) === 1;
    },
    async reserveDiscoverySessionMaterialization(args) {
      const r = db
        .prepare(
          `UPDATE discovery_sessions
           SET status = 'materialized', materialized_purchase_id = ?
           WHERE id = ? AND status = 'confirmed'`,
        )
        .run(args.purchaseId, args.sessionId);
      return Number(r.changes ?? 0) === 1;
    },
    async insertMonitoringEnrollmentQuote(args) {
      const now = args.now ?? new Date();
      const nowIso = now.toISOString();
      const expires = new Date(
        now.getTime() + (args.ttlMs ?? 15 * 60 * 1000),
      ).toISOString();
      const id = newId("quote");
      db.prepare(
        `INSERT INTO monitoring_enrollment_quotes
         (id, connection_id, account_id, purchase_id, fingerprint_id, price_amount,
          price_currency, settlement_asset, settlement_network, monitoring_deadline,
          consent_monitoring_at, consent_email_alerts_at, status, expires_at, created_at)
         VALUES (?,?,?,?,?,?,?,NULL,NULL,?,?,?,'issued',?,?)`,
      ).run(
        id,
        args.connectionId,
        args.accountId,
        args.purchaseId,
        args.fingerprintId,
        args.priceAmount,
        args.priceCurrency,
        args.monitoringDeadline,
        args.consentMonitoringAt,
        args.consentEmailAlertsAt,
        expires,
        nowIso,
      );
      return {
        id,
        connection_id: args.connectionId,
        account_id: args.accountId,
        purchase_id: args.purchaseId,
        fingerprint_id: args.fingerprintId,
        price_amount: args.priceAmount,
        price_currency: args.priceCurrency,
        settlement_asset: null,
        settlement_network: null,
        monitoring_deadline: args.monitoringDeadline,
        consent_monitoring_at: args.consentMonitoringAt,
        consent_email_alerts_at: args.consentEmailAlertsAt,
        status: "issued",
        expires_at: expires,
        created_at: nowIso,
      };
    },
    async getActiveMonitoringEnrollmentQuote(purchaseId, nowIso) {
      const row = db
        .prepare(
          `SELECT * FROM monitoring_enrollment_quotes
           WHERE purchase_id = ? AND status = 'issued' AND expires_at > ?
           ORDER BY created_at DESC LIMIT 1`,
        )
        .get(purchaseId, nowIso) as MonitoringEnrollmentQuoteRow | undefined;
      return row ?? null;
    },
    async getMonitoringEnrollmentQuoteById(quoteId) {
      const row = db
        .prepare(`SELECT * FROM monitoring_enrollment_quotes WHERE id = ?`)
        .get(quoteId) as MonitoringEnrollmentQuoteRow | undefined;
      return row ?? null;
    },

    async getLatestPaymentAttemptForQuote(quoteId) {
      const row = db
        .prepare(
          `SELECT * FROM payment_attempts WHERE quote_id = ?
           ORDER BY created_at DESC LIMIT 1`,
        )
        .get(quoteId) as PaymentAttemptRow | undefined;
      return row ?? null;
    },
    async insertPaymentAttempt(args) {
      const now = args.now ?? new Date();
      const nowIso = now.toISOString();
      const id = newId("pay");
      db.prepare(
        `INSERT INTO payment_attempts
         (id, quote_id, x402_challenge_ref, status, settlement_ref, created_at, settled_at)
         VALUES (?,?,?,'challenged',NULL,?,NULL)`,
      ).run(id, args.quoteId, args.challengeRef, nowIso);
      return {
        id,
        quote_id: args.quoteId,
        x402_challenge_ref: args.challengeRef,
        status: "challenged",
        settlement_ref: null,
        created_at: nowIso,
        settled_at: null,
      };
    },
    async markPaymentAttemptVerifying(args) {
      const r = db
        .prepare(
          `UPDATE payment_attempts
           SET status = 'verifying', settlement_ref = ?
           WHERE id = ? AND status IN ('challenged', 'verifying')`,
        )
        .run(args.settlementRef, args.attemptId);
      return Number(r.changes ?? 0) === 1;
    },
    async getMonitorActivationByQuoteId(quoteId) {
      const row = db
        .prepare(`SELECT * FROM monitor_activations WHERE quote_id = ?`)
        .get(quoteId) as MonitorActivationRow | undefined;
      return row ?? null;
    },
    async recordSettledPaymentAndActivation(args) {
      db.exec("BEGIN");
      try {
        db.prepare(
          `UPDATE payment_attempts
           SET status = 'settled', settlement_ref = ?, settled_at = ?
           WHERE id = ? AND status != 'settled'`,
        ).run(args.settlementRef, args.nowIso, args.paymentAttemptId);

        const quoteResult = db
          .prepare(
            `UPDATE monitoring_enrollment_quotes
             SET status = 'consumed'
             WHERE id = ? AND status = 'issued'`,
          )
          .run(args.quoteId);

        // Only insert when THIS call is the one that just consumed the
        // quote — never insert an activation for a quote that was not (by
        // this transaction) legitimately transitioned from 'issued'.
        if (Number(quoteResult.changes ?? 0) > 0) {
          db.prepare(
            `INSERT INTO monitor_activations
             (id, quote_id, activation_key, payment_attempt_id, purchase_id,
              fingerprint_id, monitor_id, status, created_at, projected_at)
             VALUES (?,?,?,?,?,?,?,'pending_projection',?,NULL)
             ON CONFLICT(quote_id) DO NOTHING`,
          ).run(
            args.activationId,
            args.quoteId,
            args.activationKey,
            args.paymentAttemptId,
            args.purchaseId,
            args.fingerprintId,
            args.purchaseId,
            args.nowIso,
          );
        }

        db.exec("COMMIT");
      } catch (err) {
        try {
          db.exec("ROLLBACK");
        } catch {
          /* ignore */
        }
        // A concurrent replay can lose a UNIQUE-constraint race (e.g. two
        // requests each settling their own payment_attempts row for the
        // same quote) after already losing the quote-consumption race —
        // that is a lost race, not a failure: fall through to the
        // post-transaction read, which resolves the true durable outcome.
        if (!isUniqueViolationError(err)) throw err;
      }

      const existing = await this.getMonitorActivationByQuoteId(args.quoteId);
      if (existing && existing.id === args.activationId) {
        return { outcome: "recorded" as const, activation: existing };
      }
      if (existing) {
        return { outcome: "already_existed" as const, activation: existing };
      }
      return { outcome: "quote_not_issued" as const };
    },
    async markMonitorActivationActive(args) {
      const r = db
        .prepare(
          `UPDATE monitor_activations
           SET status = 'active', projected_at = ?
           WHERE id = ? AND status != 'active'`,
        )
        .run(args.nowIso, args.activationId);
      return Number(r.changes ?? 0) === 1;
    },
    async listPendingProjectionActivations() {
      return db
        .prepare(
          `SELECT * FROM monitor_activations WHERE status = 'pending_projection'
           ORDER BY created_at ASC`,
        )
        .all() as MonitorActivationRow[];
    },
    async getMonitoringPassPaymentByDigest(authorizationDigest) {
      return (
        (db
          .prepare(
            `SELECT * FROM monitoring_pass_payments WHERE authorization_digest = ?`,
          )
          .get(authorizationDigest) as MonitoringPassPaymentRow | undefined) ??
        null
      );
    },
    async upsertMonitoringPassPayment(args) {
      db.prepare(
        `INSERT INTO monitoring_pass_payments
         (id, authorization_digest, status, settlement_ref, created_at, updated_at)
         VALUES (?,?,'verifying',NULL,?,?)
         ON CONFLICT(authorization_digest) DO NOTHING`,
      ).run(args.id, args.authorizationDigest, args.nowIso, args.nowIso);
      return (await this.getMonitoringPassPaymentByDigest(
        args.authorizationDigest,
      ))!;
    },
    async updateMonitoringPassPayment(args) {
      const r = db
        .prepare(
          `UPDATE monitoring_pass_payments
           SET status = ?, settlement_ref = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(args.status, args.settlementRef, args.nowIso, args.id);
      return Number(r.changes ?? 0) === 1;
    },
    async listVerifyingMonitoringPassPayments() {
      return db
        .prepare(
          `SELECT * FROM monitoring_pass_payments
           WHERE status = 'verifying' AND settlement_ref IS NOT NULL
           ORDER BY created_at ASC`,
        )
        .all() as MonitoringPassPaymentRow[];
    },
    async listSettledMonitoringPassPaymentsWithoutPass() {
      return db
        .prepare(
          `SELECT p.* FROM monitoring_pass_payments p
           WHERE p.status = 'settled'
             AND p.settlement_ref IS NOT NULL
             AND NOT EXISTS (
               SELECT 1 FROM monitoring_passes m
               WHERE m.settlement_ref = p.settlement_ref
                  OR m.payment_id = p.id
             )
           ORDER BY p.created_at ASC`,
        )
        .all() as MonitoringPassPaymentRow[];
    },
    async getMonitoringPassBySettlementRef(settlementRef) {
      return (
        (db
          .prepare(`SELECT * FROM monitoring_passes WHERE settlement_ref = ?`)
          .get(settlementRef) as MonitoringPassRow | undefined) ?? null
      );
    },
    async getMonitoringPassById(passId) {
      return (
        (db
          .prepare(`SELECT * FROM monitoring_passes WHERE id = ?`)
          .get(passId) as MonitoringPassRow | undefined) ?? null
      );
    },
    async issueMonitoringPass(args) {
      db.prepare(
        `INSERT INTO monitoring_passes
         (id, pass_token_hash, settlement_ref, payment_id, price_amount,
          price_currency, status, redeemed_at, redeemed_quote_id,
          redeemed_purchase_id, created_at, updated_at)
         VALUES (?,?,?,?,?,?,'issued',NULL,NULL,NULL,?,?)
         ON CONFLICT(settlement_ref) DO NOTHING`,
      ).run(
        args.id,
        args.passTokenHash,
        args.settlementRef,
        args.paymentId,
        args.priceAmount,
        args.priceCurrency,
        args.nowIso,
        args.nowIso,
      );
      const pass = (await this.getMonitoringPassBySettlementRef(
        args.settlementRef,
      ))!;
      return {
        outcome: pass.id === args.id ? ("issued" as const) : ("already_existed" as const),
        pass,
      };
    },
    async redeemMonitoringPassAndActivate(args) {
      // Idempotent replay: this pass already redeemed for this exact quote.
      const before = await this.getMonitoringPassById(args.passId);
      if (
        before &&
        before.status === "redeemed" &&
        before.redeemed_quote_id === args.quoteId
      ) {
        const existing = await this.getMonitorActivationByQuoteId(args.quoteId);
        if (existing) {
          return { outcome: "already_existed" as const, activation: existing };
        }
      }

      db.exec("BEGIN");
      try {
        const passResult = db
          .prepare(
            `UPDATE monitoring_passes
             SET status = 'redeemed', redeemed_at = ?, redeemed_quote_id = ?,
                 redeemed_purchase_id = ?, updated_at = ?
             WHERE id = ? AND status = 'issued'`,
          )
          .run(
            args.nowIso,
            args.quoteId,
            args.purchaseId,
            args.nowIso,
            args.passId,
          );
        if (Number(passResult.changes ?? 0) === 0) {
          db.exec("ROLLBACK");
          return { outcome: "pass_not_redeemable" as const };
        }

        const quoteResult = db
          .prepare(
            `UPDATE monitoring_enrollment_quotes
             SET status = 'consumed'
             WHERE id = ? AND status = 'issued'`,
          )
          .run(args.quoteId);
        if (Number(quoteResult.changes ?? 0) === 0) {
          // Never consume a pass for a quote this transaction could not claim.
          db.exec("ROLLBACK");
          return { outcome: "quote_not_issued" as const };
        }

        db.prepare(
          `INSERT INTO monitor_activations
           (id, quote_id, activation_key, payment_attempt_id, purchase_id,
            fingerprint_id, monitor_id, status, created_at, projected_at,
            monitoring_pass_id)
           VALUES (?,?,?,?,?,?,?,'pending_projection',?,NULL,?)
           ON CONFLICT(quote_id) DO NOTHING`,
        ).run(
          args.activationId,
          args.quoteId,
          args.activationKey,
          args.passId,
          args.purchaseId,
          args.fingerprintId,
          args.purchaseId,
          args.nowIso,
          args.passId,
        );

        db.exec("COMMIT");
      } catch (err) {
        try {
          db.exec("ROLLBACK");
        } catch {
          /* ignore */
        }
        if (!isUniqueViolationError(err)) throw err;
      }

      const existing = await this.getMonitorActivationByQuoteId(args.quoteId);
      if (existing && existing.id === args.activationId) {
        return { outcome: "recorded" as const, activation: existing };
      }
      if (existing) {
        return { outcome: "already_existed" as const, activation: existing };
      }
      return { outcome: "quote_not_issued" as const };
    },
    async listActiveMonitorActivations(args) {
      const limit = Math.min(Math.max(1, args?.limit ?? 50), 200);
      return db
        .prepare(
          `SELECT * FROM monitor_activations WHERE status = 'active'
           ORDER BY created_at ASC
           LIMIT ?`,
        )
        .all(limit) as MonitorActivationRow[];
    },
    async getPurchaseBlobByPurchaseId(purchaseId) {
      return (
        (db
          .prepare(
            `SELECT * FROM account_purchase_blobs WHERE purchase_id = ?`,
          )
          .get(purchaseId) as PurchaseBlobRow | undefined) ?? null
      );
    },
  };
}

// --- Postgres adapter ---

let pgPool: pg.Pool | null = null;
let pgSchemaReady = false;

/**
 * Lane 8R.3B bounded database waits. Chosen so the worst case still leaves
 * an A2MCP caller a usable response well inside a request window, and so no
 * registered endpoint can hang indefinitely on an unhealthy database.
 */
export const AUTH_DB_CONNECTION_TIMEOUT_MS = 5_000;
export const AUTH_DB_STATEMENT_TIMEOUT_MS = 8_000;
export const AUTH_DB_IDLE_TIMEOUT_MS = 30_000;

function getPool(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): pg.Pool {
  if (pgPool) return pgPool;
  const url = resolveDatabaseUrl(env);
  if (!url) throw new Error("auth_durable_db_not_configured");
  pgPool = new Pool({
    connectionString: url,
    ssl:
      env.PGSSLMODE === "disable"
        ? undefined
        : { rejectUnauthorized: false },
    max: 4,
    // Lane 8R.3B — bounded waits. `pg` defaults connectionTimeoutMillis to 0
    // (wait forever), which Lane 8R.3A identified as the only genuinely
    // unbounded path on both registered A2MCP endpoints.
    connectionTimeoutMillis: AUTH_DB_CONNECTION_TIMEOUT_MS,
    idleTimeoutMillis: AUTH_DB_IDLE_TIMEOUT_MS,
    statement_timeout: AUTH_DB_STATEMENT_TIMEOUT_MS,
    query_timeout: AUTH_DB_STATEMENT_TIMEOUT_MS,
  });
  return pgPool;
}

export function createPostgresAuthStore(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): AuthStore {
  const pool = getPool(env);

  async function q<T extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    params: unknown[] = [],
  ): Promise<pg.QueryResult<T>> {
    try {
      return await pool.query<T>(text, params);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("nobu_auth_postgres_error", {
        message: message.slice(0, 200),
      });
      throw new Error(`auth_postgres_error`);
    }
  }

  return {
    kind: "postgres",
    async ensureSchema() {
      if (pgSchemaReady) return;
      await q(AUTH_DURABLE_SCHEMA_SQL);
      for (const patch of AUTH_DURABLE_SCHEMA_PATCHES) {
        try {
          await q(patch);
        } catch {
          /* column may already exist */
        }
      }
      pgSchemaReady = true;
    },
    async getAccountById(id) {
      const r = await q<AccountRow>(
        `SELECT * FROM auth_accounts WHERE id = $1`,
        [id],
      );
      return r.rows[0] ?? null;
    },
    async getAccountByEmail(emailNormalized) {
      const r = await q<AccountRow>(
        `SELECT * FROM auth_accounts WHERE email_normalized = $1`,
        [emailNormalized],
      );
      return r.rows[0] ?? null;
    },
    async upsertAccountForEmail(emailNormalized, nowIso) {
      const existing = await this.getAccountByEmail(emailNormalized);
      if (existing) return existing;
      const id = mintAccountId();
      await q(
        `INSERT INTO auth_accounts (id, email_normalized, email_verified_at, created_at, updated_at)
         VALUES ($1,$2,NULL,$3,$4)
         ON CONFLICT (email_normalized) DO NOTHING`,
        [id, emailNormalized, nowIso, nowIso],
      );
      return (await this.getAccountByEmail(emailNormalized))!;
    },
    async markAccountVerified(accountId, nowIso) {
      await q(
        `UPDATE auth_accounts
         SET email_verified_at = COALESCE(email_verified_at, $1), updated_at = $2
         WHERE id = $3`,
        [nowIso, nowIso, accountId],
      );
    },
    async insertLoginToken(args) {
      const now = args.now ?? new Date();
      const nowIso = now.toISOString();
      const expires = new Date(
        now.getTime() + (args.ttlMs ?? AUTH_LOGIN_TOKEN_TTL_MS),
      ).toISOString();
      const id = newId("tok");
      const token_hash = sha256Hex(args.rawToken);
      await q(
        `INSERT INTO auth_login_tokens
         (id, email_normalized, token_hash, expires_at, used_at, created_at, request_ip_hash, guest_owner_ref)
         VALUES ($1,$2,$3,$4,NULL,$5,NULL,$6)`,
        [
          id,
          args.emailNormalized,
          token_hash,
          expires,
          nowIso,
          args.guestOwnerRef,
        ],
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
    },
    async findLoginTokenByHash(tokenHash) {
      const r = await q<LoginTokenRow>(
        `SELECT * FROM auth_login_tokens WHERE token_hash = $1`,
        [tokenHash],
      );
      return r.rows[0] ?? null;
    },
    async markLoginTokenUsed(tokenId, nowIso) {
      const r = await q(
        `UPDATE auth_login_tokens SET used_at = $1
         WHERE id = $2 AND used_at IS NULL`,
        [nowIso, tokenId],
      );
      return (r.rowCount ?? 0) === 1;
    },
    async createSession(args) {
      const now = args.now ?? new Date();
      const nowIso = now.toISOString();
      const maxAge = args.maxAgeSeconds ?? AUTH_SESSION_MAX_AGE_SECONDS;
      const expires = new Date(now.getTime() + maxAge * 1000).toISOString();
      const id = newId("sess");
      const token_hash = sha256Hex(args.rawSessionToken);
      await q(
        `INSERT INTO auth_sessions
         (id, account_id, token_hash, expires_at, revoked_at, created_at, last_seen_at)
         VALUES ($1,$2,$3,$4,NULL,$5,$6)`,
        [id, args.accountId, token_hash, expires, nowIso, nowIso],
      );
      return {
        id,
        account_id: args.accountId,
        token_hash,
        expires_at: expires,
        revoked_at: null,
        created_at: nowIso,
        last_seen_at: nowIso,
      };
    },
    async findSessionByTokenHash(tokenHash) {
      const r = await q<SessionRow>(
        `SELECT * FROM auth_sessions WHERE token_hash = $1`,
        [tokenHash],
      );
      return r.rows[0] ?? null;
    },
    async revokeSession(sessionId, nowIso) {
      await q(
        `UPDATE auth_sessions SET revoked_at = $1 WHERE id = $2 AND revoked_at IS NULL`,
        [nowIso, sessionId],
      );
    },
    async touchSession(sessionId, nowIso) {
      await q(`UPDATE auth_sessions SET last_seen_at = $1 WHERE id = $2`, [
        nowIso,
        sessionId,
      ]);
    },
    async consumeRateLimit(args) {
      const now = args.now ?? new Date();
      const windowMs = args.windowMs ?? AUTH_RATE_LIMIT_WINDOW_MS;
      const maxHits = args.maxHits ?? AUTH_RATE_LIMIT_MAX;
      const r = await q<{ window_started_at: string; hit_count: number }>(
        `SELECT * FROM auth_rate_limits WHERE bucket_key = $1`,
        [args.bucketKey],
      );
      const row = r.rows[0];
      if (!row) {
        await q(
          `INSERT INTO auth_rate_limits (bucket_key, window_started_at, hit_count)
           VALUES ($1,$2,1)
           ON CONFLICT (bucket_key) DO NOTHING`,
          [args.bucketKey, now.toISOString()],
        );
        return true;
      }
      const started = Date.parse(row.window_started_at);
      if (!Number.isFinite(started) || now.getTime() - started > windowMs) {
        await q(
          `UPDATE auth_rate_limits SET window_started_at = $1, hit_count = 1 WHERE bucket_key = $2`,
          [now.toISOString(), args.bucketKey],
        );
        return true;
      }
      if (row.hit_count >= maxHits) return false;
      await q(
        `UPDATE auth_rate_limits SET hit_count = hit_count + 1 WHERE bucket_key = $1`,
        [args.bucketKey],
      );
      return true;
    },
    async recordClaimEvent(args) {
      const prior = await q<{ purchases_claimed: number }>(
        `SELECT purchases_claimed FROM auth_claim_events
         WHERE account_id = $1 AND guest_owner_ref = $2`,
        [args.accountId, args.guestOwnerRef],
      );
      if (prior.rows[0]) {
        return {
          already: true,
          claimed: prior.rows[0].purchases_claimed,
        };
      }
      try {
        await q(
          `INSERT INTO auth_claim_events (id, account_id, guest_owner_ref, purchases_claimed, created_at)
           VALUES ($1,$2,$3,$4,$5)`,
          [
            newId("claim"),
            args.accountId,
            args.guestOwnerRef,
            args.purchasesClaimed,
            args.nowIso,
          ],
        );
        return { already: false, claimed: args.purchasesClaimed };
      } catch {
        const again = await q<{ purchases_claimed: number }>(
          `SELECT purchases_claimed FROM auth_claim_events
           WHERE account_id = $1 AND guest_owner_ref = $2`,
          [args.accountId, args.guestOwnerRef],
        );
        if (again.rows[0]) {
          return {
            already: true,
            claimed: again.rows[0].purchases_claimed,
          };
        }
        throw new Error("auth_claim_event_failed");
      }
    },
    async savePurchaseBlob(args) {
      const existing = await q<{
        archived_at: string | null;
        user_outcome: string | null;
        user_outcome_at: string | null;
        email_alerts_enabled: number | null;
        email_alerts_consent_at: string | null;
        email_alerts_disabled_at: string | null;
      }>(
        `SELECT archived_at, user_outcome, user_outcome_at,
                email_alerts_enabled, email_alerts_consent_at, email_alerts_disabled_at
         FROM account_purchase_blobs WHERE purchase_id = $1`,
        [args.purchaseId],
      );
      const prev = existing.rows[0];
      const archived =
        args.archived_at !== undefined
          ? args.archived_at
          : (prev?.archived_at ?? null);
      const outcome =
        args.user_outcome !== undefined
          ? args.user_outcome
          : (prev?.user_outcome ?? null);
      const outcomeAt =
        args.user_outcome_at !== undefined
          ? args.user_outcome_at
          : (prev?.user_outcome_at ?? null);
      const emailOn = prev?.email_alerts_enabled ?? 0;
      const emailConsent = prev?.email_alerts_consent_at ?? null;
      const emailDisabled = prev?.email_alerts_disabled_at ?? null;
      await q(
        `INSERT INTO account_purchase_blobs
         (purchase_id, account_id, blob_json, updated_at, archived_at, user_outcome, user_outcome_at,
          email_alerts_enabled, email_alerts_consent_at, email_alerts_disabled_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (purchase_id) DO UPDATE SET
           account_id = EXCLUDED.account_id,
           blob_json = EXCLUDED.blob_json,
           updated_at = EXCLUDED.updated_at,
           archived_at = EXCLUDED.archived_at,
           user_outcome = EXCLUDED.user_outcome,
           user_outcome_at = EXCLUDED.user_outcome_at`,
        [
          args.purchaseId,
          args.accountId,
          args.blobJson,
          args.nowIso,
          archived,
          outcome,
          outcomeAt,
          emailOn,
          emailConsent,
          emailDisabled,
        ],
      );
    },
    async listPurchaseBlobs(accountId) {
      const r = await q<PurchaseBlobRow>(
        `SELECT * FROM account_purchase_blobs WHERE account_id = $1 ORDER BY updated_at DESC`,
        [accountId],
      );
      return r.rows;
    },
    async getPurchaseBlob(accountId, purchaseId) {
      const r = await q<PurchaseBlobRow>(
        `SELECT * FROM account_purchase_blobs WHERE account_id = $1 AND purchase_id = $2`,
        [accountId, purchaseId],
      );
      return r.rows[0] ?? null;
    },
    async updatePurchaseLifecycleMeta(args) {
      const row = await this.getPurchaseBlob(args.accountId, args.purchaseId);
      if (!row) return false;
      const archived =
        args.archived_at !== undefined ? args.archived_at : row.archived_at;
      const outcome =
        args.user_outcome !== undefined ? args.user_outcome : row.user_outcome;
      const outcomeAt =
        args.user_outcome_at !== undefined
          ? args.user_outcome_at
          : row.user_outcome_at;
      const emailOn =
        args.email_alerts_enabled !== undefined
          ? args.email_alerts_enabled
          : (row.email_alerts_enabled ?? 0);
      const emailConsent =
        args.email_alerts_consent_at !== undefined
          ? args.email_alerts_consent_at
          : (row.email_alerts_consent_at ?? null);
      const emailDisabled =
        args.email_alerts_disabled_at !== undefined
          ? args.email_alerts_disabled_at
          : (row.email_alerts_disabled_at ?? null);
      await q(
        `UPDATE account_purchase_blobs
         SET archived_at = $1, user_outcome = $2, user_outcome_at = $3,
             email_alerts_enabled = $4, email_alerts_consent_at = $5,
             email_alerts_disabled_at = $6, updated_at = $7
         WHERE account_id = $8 AND purchase_id = $9`,
        [
          archived,
          outcome,
          outcomeAt,
          emailOn,
          emailConsent,
          emailDisabled,
          args.nowIso,
          args.accountId,
          args.purchaseId,
        ],
      );
      return true;
    },
    async deletePurchaseBlob(args) {
      const r = await q(
        `DELETE FROM account_purchase_blobs WHERE account_id = $1 AND purchase_id = $2`,
        [args.accountId, args.purchaseId],
      );
      return (r.rowCount ?? 0) > 0;
    },

    async insertAgentConnection(args) {
      const now = args.now ?? new Date();
      const nowIso = now.toISOString();
      const id = newId("conn");
      await q(
        `INSERT INTO agent_connections
         (id, account_id, email_normalized, connection_token_hash, credential_expires_at,
          credential_rotated_at, status, revoked_at, created_at, last_used_at)
         VALUES ($1,NULL,$2,NULL,NULL,NULL,'pending',NULL,$3,NULL)`,
        [id, args.emailNormalized, nowIso],
      );
      return (await this.getAgentConnectionById(id))!;
    },
    async getAgentConnectionById(id) {
      const r = await q<AgentConnectionRow>(
        `SELECT * FROM agent_connections WHERE id = $1`,
        [id],
      );
      return r.rows[0] ?? null;
    },
    async setAgentConnectionCredential(args) {
      const r = await q(
        `UPDATE agent_connections
         SET connection_token_hash = $1,
             credential_expires_at = $2,
             credential_rotated_at = $3,
             status = 'active',
             account_id = COALESCE($4, account_id)
         WHERE id = $5 AND status != 'revoked'`,
        [
          args.tokenHash,
          args.expiresAt,
          args.nowIso,
          args.accountId ?? null,
          args.connectionId,
        ],
      );
      return (r.rowCount ?? 0) === 1;
    },
    async revokeAgentConnection(args) {
      const r = await q(
        `UPDATE agent_connections
         SET status = 'revoked', revoked_at = $1, connection_token_hash = NULL
         WHERE id = $2 AND status != 'revoked'`,
        [args.nowIso, args.connectionId],
      );
      return (r.rowCount ?? 0) === 1;
    },
    async touchAgentConnectionLastUsed(args) {
      await q(
        `UPDATE agent_connections SET last_used_at = $1 WHERE id = $2`,
        [args.nowIso, args.connectionId],
      );
    },
    async insertAgentEmailCode(args) {
      const now = args.now ?? new Date();
      const nowIso = now.toISOString();
      const expires = new Date(
        now.getTime() + (args.ttlMs ?? 10 * 60 * 1000),
      ).toISOString();
      const id = newId("aec");
      const code_hash = sha256Hex(args.rawCode);
      await q(
        `INSERT INTO agent_email_codes
         (id, connection_id, email_normalized, code_hash, expires_at, attempt_count, used_at, created_at)
         VALUES ($1,$2,$3,$4,$5,0,NULL,$6)`,
        [id, args.connectionId, args.emailNormalized, code_hash, expires, nowIso],
      );
      return {
        id,
        connection_id: args.connectionId,
        email_normalized: args.emailNormalized,
        code_hash,
        expires_at: expires,
        attempt_count: 0,
        used_at: null,
        created_at: nowIso,
      };
    },
    async findLatestAgentEmailCode(connectionId) {
      const r = await q<AgentEmailCodeRow>(
        `SELECT * FROM agent_email_codes
         WHERE connection_id = $1 AND used_at IS NULL
         ORDER BY created_at DESC LIMIT 1`,
        [connectionId],
      );
      return r.rows[0] ?? null;
    },
    async markAgentEmailCodeUsed(codeId, nowIso) {
      const r = await q(
        `UPDATE agent_email_codes SET used_at = $1 WHERE id = $2 AND used_at IS NULL`,
        [nowIso, codeId],
      );
      return (r.rowCount ?? 0) === 1;
    },
    async incrementAgentEmailCodeAttempt(codeId) {
      const r = await q<{ attempt_count: number }>(
        `UPDATE agent_email_codes SET attempt_count = attempt_count + 1
         WHERE id = $1 RETURNING attempt_count`,
        [codeId],
      );
      return r.rows[0]?.attempt_count ?? 0;
    },

    async insertDiscoverySession(args) {
      const now = args.now ?? new Date();
      const nowIso = now.toISOString();
      const expires = new Date(
        now.getTime() + (args.ttlMs ?? 30 * 60 * 1000),
      ).toISOString();
      const id = newId("disc");
      await q(
        `INSERT INTO discovery_sessions
         (id, structured_snapshot_json, purchase_text_hash, candidates_snapshot_json,
          selected_candidate_id, locked_fingerprint_snapshot_json, status,
          materialized_purchase_id, created_at, expires_at)
         VALUES ($1,$2,$3,$4,NULL,NULL,'discovering',NULL,$5,$6)`,
        [
          id,
          args.structuredSnapshotJson,
          args.purchaseTextHash,
          args.candidatesSnapshotJson,
          nowIso,
          expires,
        ],
      );
      return (await this.getDiscoverySessionById(id))!;
    },
    async getDiscoverySessionById(id) {
      const r = await q<DiscoverySessionRow>(
        `SELECT * FROM discovery_sessions WHERE id = $1`,
        [id],
      );
      return r.rows[0] ?? null;
    },
    async confirmDiscoverySession(args) {
      const r = await q(
        `UPDATE discovery_sessions
         SET selected_candidate_id = $1, locked_fingerprint_snapshot_json = $2, status = 'confirmed'
         WHERE id = $3 AND status IN ('discovering', 'confirmed')`,
        [
          args.selectedCandidateId,
          args.lockedFingerprintSnapshotJson,
          args.sessionId,
        ],
      );
      return (r.rowCount ?? 0) === 1;
    },
    async reserveDiscoverySessionMaterialization(args) {
      const r = await q(
        `UPDATE discovery_sessions
         SET status = 'materialized', materialized_purchase_id = $1
         WHERE id = $2 AND status = 'confirmed'`,
        [args.purchaseId, args.sessionId],
      );
      return (r.rowCount ?? 0) === 1;
    },
    async insertMonitoringEnrollmentQuote(args) {
      const now = args.now ?? new Date();
      const nowIso = now.toISOString();
      const expires = new Date(
        now.getTime() + (args.ttlMs ?? 15 * 60 * 1000),
      ).toISOString();
      const id = newId("quote");
      await q(
        `INSERT INTO monitoring_enrollment_quotes
         (id, connection_id, account_id, purchase_id, fingerprint_id, price_amount,
          price_currency, settlement_asset, settlement_network, monitoring_deadline,
          consent_monitoring_at, consent_email_alerts_at, status, expires_at, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,NULL,$8,$9,$10,'issued',$11,$12)`,
        [
          id,
          args.connectionId,
          args.accountId,
          args.purchaseId,
          args.fingerprintId,
          args.priceAmount,
          args.priceCurrency,
          args.monitoringDeadline,
          args.consentMonitoringAt,
          args.consentEmailAlertsAt,
          expires,
          nowIso,
        ],
      );
      return {
        id,
        connection_id: args.connectionId,
        account_id: args.accountId,
        purchase_id: args.purchaseId,
        fingerprint_id: args.fingerprintId,
        price_amount: args.priceAmount,
        price_currency: args.priceCurrency,
        settlement_asset: null,
        settlement_network: null,
        monitoring_deadline: args.monitoringDeadline,
        consent_monitoring_at: args.consentMonitoringAt,
        consent_email_alerts_at: args.consentEmailAlertsAt,
        status: "issued",
        expires_at: expires,
        created_at: nowIso,
      };
    },
    async getActiveMonitoringEnrollmentQuote(purchaseId, nowIso) {
      const r = await q<MonitoringEnrollmentQuoteRow>(
        `SELECT * FROM monitoring_enrollment_quotes
         WHERE purchase_id = $1 AND status = 'issued' AND expires_at > $2
         ORDER BY created_at DESC LIMIT 1`,
        [purchaseId, nowIso],
      );
      return r.rows[0] ?? null;
    },
    async getMonitoringEnrollmentQuoteById(quoteId) {
      const r = await q<MonitoringEnrollmentQuoteRow>(
        `SELECT * FROM monitoring_enrollment_quotes WHERE id = $1`,
        [quoteId],
      );
      return r.rows[0] ?? null;
    },

    async getLatestPaymentAttemptForQuote(quoteId) {
      const r = await q<PaymentAttemptRow>(
        `SELECT * FROM payment_attempts WHERE quote_id = $1
         ORDER BY created_at DESC LIMIT 1`,
        [quoteId],
      );
      return r.rows[0] ?? null;
    },
    async insertPaymentAttempt(args) {
      const now = args.now ?? new Date();
      const nowIso = now.toISOString();
      const id = newId("pay");
      await q(
        `INSERT INTO payment_attempts
         (id, quote_id, x402_challenge_ref, status, settlement_ref, created_at, settled_at)
         VALUES ($1,$2,$3,'challenged',NULL,$4,NULL)`,
        [id, args.quoteId, args.challengeRef, nowIso],
      );
      return {
        id,
        quote_id: args.quoteId,
        x402_challenge_ref: args.challengeRef,
        status: "challenged",
        settlement_ref: null,
        created_at: nowIso,
        settled_at: null,
      };
    },
    async markPaymentAttemptVerifying(args) {
      const r = await q(
        `UPDATE payment_attempts
         SET status = 'verifying', settlement_ref = $1
         WHERE id = $2 AND status IN ('challenged', 'verifying')`,
        [args.settlementRef, args.attemptId],
      );
      return (r.rowCount ?? 0) === 1;
    },
    async getMonitorActivationByQuoteId(quoteId) {
      const r = await q<MonitorActivationRow>(
        `SELECT * FROM monitor_activations WHERE quote_id = $1`,
        [quoteId],
      );
      return r.rows[0] ?? null;
    },
    async recordSettledPaymentAndActivation(args) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        await client.query(
          `UPDATE payment_attempts
           SET status = 'settled', settlement_ref = $1, settled_at = $2
           WHERE id = $3 AND status != 'settled'`,
          [args.settlementRef, args.nowIso, args.paymentAttemptId],
        );

        const quoteResult = await client.query(
          `UPDATE monitoring_enrollment_quotes
           SET status = 'consumed'
           WHERE id = $1 AND status = 'issued'`,
          [args.quoteId],
        );

        // Only insert when THIS call is the one that just consumed the
        // quote — never insert an activation for a quote that was not (by
        // this transaction) legitimately transitioned from 'issued'.
        if ((quoteResult.rowCount ?? 0) > 0) {
          await client.query(
            `INSERT INTO monitor_activations
             (id, quote_id, activation_key, payment_attempt_id, purchase_id,
              fingerprint_id, monitor_id, status, created_at, projected_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,'pending_projection',$8,NULL)
             ON CONFLICT (quote_id) DO NOTHING`,
            [
              args.activationId,
              args.quoteId,
              args.activationKey,
              args.paymentAttemptId,
              args.purchaseId,
              args.fingerprintId,
              args.purchaseId,
              args.nowIso,
            ],
          );
        }

        await client.query("COMMIT");
      } catch (err) {
        try {
          await client.query("ROLLBACK");
        } catch {
          /* ignore */
        }
        // A concurrent replay can lose a UNIQUE-constraint race after
        // already losing the quote-consumption race — a lost race, not a
        // failure: fall through to the post-transaction read below.
        if (!isUniqueViolationError(err)) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("nobu_auth_postgres_error", {
            message: message.slice(0, 200),
          });
          throw new Error("auth_postgres_error");
        }
      } finally {
        client.release();
      }

      const existing = await this.getMonitorActivationByQuoteId(args.quoteId);
      if (existing && existing.id === args.activationId) {
        return { outcome: "recorded" as const, activation: existing };
      }
      if (existing) {
        return { outcome: "already_existed" as const, activation: existing };
      }
      return { outcome: "quote_not_issued" as const };
    },
    async markMonitorActivationActive(args) {
      const r = await q(
        `UPDATE monitor_activations
         SET status = 'active', projected_at = $1
         WHERE id = $2 AND status != 'active'`,
        [args.nowIso, args.activationId],
      );
      return (r.rowCount ?? 0) === 1;
    },
    async listPendingProjectionActivations() {
      const r = await q<MonitorActivationRow>(
        `SELECT * FROM monitor_activations WHERE status = 'pending_projection'
         ORDER BY created_at ASC`,
      );
      return r.rows;
    },
    async getMonitoringPassPaymentByDigest(authorizationDigest) {
      const r = await q<MonitoringPassPaymentRow>(
        `SELECT * FROM monitoring_pass_payments WHERE authorization_digest = $1`,
        [authorizationDigest],
      );
      return r.rows[0] ?? null;
    },
    async upsertMonitoringPassPayment(args) {
      await q(
        `INSERT INTO monitoring_pass_payments
         (id, authorization_digest, status, settlement_ref, created_at, updated_at)
         VALUES ($1,$2,'verifying',NULL,$3,$3)
         ON CONFLICT (authorization_digest) DO NOTHING`,
        [args.id, args.authorizationDigest, args.nowIso],
      );
      return (await this.getMonitoringPassPaymentByDigest(
        args.authorizationDigest,
      ))!;
    },
    async updateMonitoringPassPayment(args) {
      const r = await q(
        `UPDATE monitoring_pass_payments
         SET status = $1, settlement_ref = $2, updated_at = $3
         WHERE id = $4`,
        [args.status, args.settlementRef, args.nowIso, args.id],
      );
      return (r.rowCount ?? 0) === 1;
    },
    async listVerifyingMonitoringPassPayments() {
      const r = await q<MonitoringPassPaymentRow>(
        `SELECT * FROM monitoring_pass_payments
         WHERE status = 'verifying' AND settlement_ref IS NOT NULL
         ORDER BY created_at ASC`,
      );
      return r.rows;
    },
    async listSettledMonitoringPassPaymentsWithoutPass() {
      const r = await q<MonitoringPassPaymentRow>(
        `SELECT p.* FROM monitoring_pass_payments p
         WHERE p.status = 'settled'
           AND p.settlement_ref IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM monitoring_passes m
             WHERE m.settlement_ref = p.settlement_ref
                OR m.payment_id = p.id
           )
         ORDER BY p.created_at ASC`,
      );
      return r.rows;
    },
    async getMonitoringPassBySettlementRef(settlementRef) {
      const r = await q<MonitoringPassRow>(
        `SELECT * FROM monitoring_passes WHERE settlement_ref = $1`,
        [settlementRef],
      );
      return r.rows[0] ?? null;
    },
    async getMonitoringPassById(passId) {
      const r = await q<MonitoringPassRow>(
        `SELECT * FROM monitoring_passes WHERE id = $1`,
        [passId],
      );
      return r.rows[0] ?? null;
    },
    async issueMonitoringPass(args) {
      await q(
        `INSERT INTO monitoring_passes
         (id, pass_token_hash, settlement_ref, payment_id, price_amount,
          price_currency, status, redeemed_at, redeemed_quote_id,
          redeemed_purchase_id, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,'issued',NULL,NULL,NULL,$7,$7)
         ON CONFLICT (settlement_ref) DO NOTHING`,
        [
          args.id,
          args.passTokenHash,
          args.settlementRef,
          args.paymentId,
          args.priceAmount,
          args.priceCurrency,
          args.nowIso,
        ],
      );
      const pass = (await this.getMonitoringPassBySettlementRef(
        args.settlementRef,
      ))!;
      return {
        outcome:
          pass.id === args.id ? ("issued" as const) : ("already_existed" as const),
        pass,
      };
    },
    async redeemMonitoringPassAndActivate(args) {
      const before = await this.getMonitoringPassById(args.passId);
      if (
        before &&
        before.status === "redeemed" &&
        before.redeemed_quote_id === args.quoteId
      ) {
        const existing = await this.getMonitorActivationByQuoteId(args.quoteId);
        if (existing) {
          return { outcome: "already_existed" as const, activation: existing };
        }
      }

      const client = await pool.connect();
      let claimFailure: "pass_not_redeemable" | "quote_not_issued" | null = null;
      try {
        await client.query("BEGIN");
        const passResult = await client.query(
          `UPDATE monitoring_passes
           SET status = 'redeemed', redeemed_at = $1, redeemed_quote_id = $2,
               redeemed_purchase_id = $3, updated_at = $1
           WHERE id = $4 AND status = 'issued'`,
          [args.nowIso, args.quoteId, args.purchaseId, args.passId],
        );
        if ((passResult.rowCount ?? 0) === 0) {
          await client.query("ROLLBACK");
          claimFailure = "pass_not_redeemable";
        } else {
          const quoteResult = await client.query(
            `UPDATE monitoring_enrollment_quotes
             SET status = 'consumed'
             WHERE id = $1 AND status = 'issued'`,
            [args.quoteId],
          );
          if ((quoteResult.rowCount ?? 0) === 0) {
            // Never consume a pass for a quote this transaction could not claim.
            await client.query("ROLLBACK");
            claimFailure = "quote_not_issued";
          } else {
            await client.query(
              `INSERT INTO monitor_activations
               (id, quote_id, activation_key, payment_attempt_id, purchase_id,
                fingerprint_id, monitor_id, status, created_at, projected_at,
                monitoring_pass_id)
               VALUES ($1,$2,$3,$4,$5,$6,$5,'pending_projection',$7,NULL,$4)
               ON CONFLICT (quote_id) DO NOTHING`,
              [
                args.activationId,
                args.quoteId,
                args.activationKey,
                args.passId,
                args.purchaseId,
                args.fingerprintId,
                args.nowIso,
              ],
            );
            await client.query("COMMIT");
          }
        }
      } catch (err) {
        try {
          await client.query("ROLLBACK");
        } catch {
          /* ignore */
        }
        if (!isUniqueViolationError(err)) {
          client.release();
          throw err;
        }
      } finally {
        client.release();
      }

      if (claimFailure) return { outcome: claimFailure };

      const existing = await this.getMonitorActivationByQuoteId(args.quoteId);
      if (existing && existing.id === args.activationId) {
        return { outcome: "recorded" as const, activation: existing };
      }
      if (existing) {
        return { outcome: "already_existed" as const, activation: existing };
      }
      return { outcome: "quote_not_issued" as const };
    },
    async listActiveMonitorActivations(args) {
      const limit = Math.min(Math.max(1, args?.limit ?? 50), 200);
      const r = await q<MonitorActivationRow>(
        `SELECT * FROM monitor_activations WHERE status = 'active'
         ORDER BY created_at ASC
         LIMIT $1`,
        [limit],
      );
      return r.rows;
    },
    async getPurchaseBlobByPurchaseId(purchaseId) {
      const r = await q<PurchaseBlobRow>(
        `SELECT * FROM account_purchase_blobs WHERE purchase_id = $1`,
        [purchaseId],
      );
      return r.rows[0] ?? null;
    },
  };
}

let cachedStore: AuthStore | null = null;

/**
 * Resolve auth store: Postgres when durable URL present (production),
 * else SQLite for tests/local.
 */
export async function getAuthStore(args?: {
  sqliteDb?: NobuDatabase;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  forceSqlite?: boolean;
}): Promise<AuthStore> {
  const env = args?.env ?? process.env;
  if (
    !args?.forceSqlite &&
    hasDurableDatabaseUrl(env) &&
    !isAuthTestMode(env)
  ) {
    if (cachedStore?.kind === "postgres") {
      await cachedStore.ensureSchema();
      return cachedStore;
    }
    const store = createPostgresAuthStore(env);
    await store.ensureSchema();
    cachedStore = store;
    return store;
  }

  // Tests / local: prefer provided sqlite, else open web db lazily
  let db = args?.sqliteDb;
  if (!db) {
    const { getWebDatabase } = await import("../web/db.js");
    db = getWebDatabase();
  }
  const store = createSqliteAuthStore(db);
  await store.ensureSchema();
  return store;
}

/** Test helper — drop cached postgres pool binding. */
export function resetAuthStoreCache(): void {
  cachedStore = null;
  pgSchemaReady = false;
  if (pgPool) {
    void pgPool.end().catch(() => {});
    pgPool = null;
  }
}

export function durableDbManualActions(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): string[] {
  if (hasDurableDatabaseUrl(env) || isAuthTestMode(env)) return [];
  return [
    "DATABASE_URL or POLICY_OPS_DATABASE_URL (Postgres) for durable auth across Vercel instances",
  ];
}
