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

export type PurchaseBlobRow = {
  purchase_id: string;
  account_id: string;
  blob_json: string;
  updated_at: string;
  archived_at: string | null;
  user_outcome: string | null;
  user_outcome_at: string | null;
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
    nowIso: string;
  }): Promise<boolean>;
  deletePurchaseBlob(args: {
    accountId: string;
    purchaseId: string;
  }): Promise<boolean>;
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
          `SELECT archived_at, user_outcome, user_outcome_at FROM account_purchase_blobs WHERE purchase_id = ?`,
        )
        .get(args.purchaseId) as
        | {
            archived_at: string | null;
            user_outcome: string | null;
            user_outcome_at: string | null;
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
      db.prepare(
        `INSERT INTO account_purchase_blobs
         (purchase_id, account_id, blob_json, updated_at, archived_at, user_outcome, user_outcome_at)
         VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(purchase_id) DO UPDATE SET
           account_id = excluded.account_id,
           blob_json = excluded.blob_json,
           updated_at = excluded.updated_at,
           archived_at = excluded.archived_at,
           user_outcome = excluded.user_outcome,
           user_outcome_at = excluded.user_outcome_at`,
      ).run(
        args.purchaseId,
        args.accountId,
        args.blobJson,
        args.nowIso,
        archived,
        outcome,
        outcomeAt,
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
      db.prepare(
        `UPDATE account_purchase_blobs
         SET archived_at = ?, user_outcome = ?, user_outcome_at = ?, updated_at = ?
         WHERE account_id = ? AND purchase_id = ?`,
      ).run(
        archived,
        outcome,
        outcomeAt,
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
  };
}

// --- Postgres adapter ---

let pgPool: pg.Pool | null = null;
let pgSchemaReady = false;

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
      }>(
        `SELECT archived_at, user_outcome, user_outcome_at FROM account_purchase_blobs WHERE purchase_id = $1`,
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
      await q(
        `INSERT INTO account_purchase_blobs
         (purchase_id, account_id, blob_json, updated_at, archived_at, user_outcome, user_outcome_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
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
      await q(
        `UPDATE account_purchase_blobs
         SET archived_at = $1, user_outcome = $2, user_outcome_at = $3, updated_at = $4
         WHERE account_id = $5 AND purchase_id = $6`,
        [
          archived,
          outcome,
          outcomeAt,
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
