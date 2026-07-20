/**
 * Lane 7.4D — $0.99 paid monitoring activation.
 *
 * Private, unregistered endpoint (`POST /v1/agent/start-monitoring`) — not
 * registered with OKX, not advertised, not part of ASP #5541. Reuses Lane
 * 7.4B connection authorization and reads all authoritative values
 * server-side from the durable quote/purchase rows; the request body may
 * only ever carry `quote_id` + `connection_id` + `connection_token`.
 *
 * Durable saga (not a single cross-store transaction — the AuthStore's
 * durable Postgres and the purchases database (`src/web/db.ts`,
 * per-instance /tmp SQLite in production) are genuinely separate stores):
 *   1. One transaction inside the AuthStore only: mark the payment attempt
 *      settled, consume the quote, insert exactly one monitor_activations
 *      row (`pending_projection`) — see
 *      `AuthStore#recordSettledPaymentAndActivation`.
 *   2. Project: flip `purchases.status` to `MONITORING_ACTIVE` in the
 *      separate purchases database, then persist the durable account blob.
 *   3. Only once (2) fully succeeds, mark the activation `active`.
 * If (2) fails, the activation stays `pending_projection` — no repayment is
 * ever requested; `reconcilePendingActivations` retries (2)+(3) later.
 */
import { randomUUID } from "node:crypto";
import { getWebDatabase } from "../web/db.js";
import type { NobuDatabase } from "../db/index.js";
import { MONITORING_PAYMENT_READY_STATUS } from "../matching/store.js";
import { getAuthStore, isAccountOwnerRef, type AuthStore, type MonitorActivationRow } from "../auth/auth-store.js";
import { authorizeAgentConnection } from "../auth/agent-connections.js";
import { persistAccountPurchaseIfNeeded } from "../auth/service.js";
import { sha256Hex } from "../auth/crypto.js";
import {
  buildX402Challenge,
  encodeX402ChallengeHeader,
  resolveX402Verifier,
  MONITORING_PRICE_USD,
  type X402Challenge,
  type X402Verifier,
} from "./x402.js";

type EnvRecord = NodeJS.ProcessEnv | Record<string, string | undefined>;

function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

async function resolveStore(
  sqliteDb?: NobuDatabase,
  env?: EnvRecord,
): Promise<AuthStore> {
  return getAuthStore({ sqliteDb, env });
}

export interface StartMonitoringArgs {
  quoteId: string;
  connectionId: string;
  connectionToken: string;
  /** Raw PAYMENT-SIGNATURE header value from the client's replay, or null on the first (unpaid) attempt. Never persisted. */
  paymentAuthorizationHeader: string | null;
  /** The exact resource URL this challenge is bound to. */
  resource: string;
  now?: Date;
  sqliteDb?: NobuDatabase;
  env?: EnvRecord;
  /** Tests only — forbidden outside test mode by resolveX402Verifier. */
  testVerifier?: X402Verifier;
}

export type StartMonitoringResult =
  | {
      ok: true;
      status: "MONITORING_STARTED" | "ALREADY_ACTIVE";
      monitor_id: string;
      monitoring_deadline: string | null;
      http_status: 200;
    }
  | {
      ok: true;
      status: "ACTIVATION_PENDING";
      monitor_id: string;
      http_status: 200;
    }
  | { ok: false; status: "ACTION_NOT_AUTHORIZED"; http_status: 401 }
  | { ok: false; status: "CONNECTION_EXPIRED"; http_status: 404 }
  | {
      ok: false;
      status: "PAYMENT_PENDING";
      challenge: X402Challenge;
      challengeHeaderValue: string;
      http_status: 402;
    };

async function projectActivation(args: {
  purchaseId: string;
  nowIso: string;
}): Promise<{ ok: boolean; monitoringDeadline: string | null }> {
  try {
    const db = getWebDatabase();
    const purchaseRow = db
      .prepare(`SELECT * FROM purchases WHERE id = ?`)
      .get(args.purchaseId) as Record<string, unknown> | undefined;
    if (!purchaseRow) return { ok: false, monitoringDeadline: null };

    db.prepare(
      `UPDATE purchases SET status = 'MONITORING_ACTIVE', updated_at = ?
       WHERE id = ? AND status != 'MONITORING_ACTIVE'`,
    ).run(args.nowIso, args.purchaseId);

    const ownerRef = String(purchaseRow.user_ref ?? "").trim();
    if (ownerRef) {
      await persistAccountPurchaseIfNeeded({
        purchaseDb: db,
        purchaseId: args.purchaseId,
        ownerRef,
      });
    }
    return {
      ok: true,
      monitoringDeadline: (purchaseRow.monitoring_deadline as string | null) ?? null,
    };
  } catch (err) {
    console.error("nobu_payment_projection_failed", {
      message: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, monitoringDeadline: null };
  }
}

async function resolveActivationResponse(args: {
  activation: MonitorActivationRow;
  sqliteDb?: NobuDatabase;
  env?: EnvRecord;
  nowIso: string;
  firstTime: boolean;
}): Promise<StartMonitoringResult> {
  const projected = await projectActivation({
    purchaseId: args.activation.purchase_id,
    nowIso: args.nowIso,
  });

  if (!projected.ok) {
    return {
      ok: true,
      status: "ACTIVATION_PENDING",
      monitor_id: args.activation.monitor_id,
      http_status: 200,
    };
  }

  if (args.activation.status !== "active") {
    const store = await resolveStore(args.sqliteDb, args.env);
    await store.markMonitorActivationActive({
      activationId: args.activation.id,
      nowIso: args.nowIso,
    });
  }

  return {
    ok: true,
    status: args.firstTime ? "MONITORING_STARTED" : "ALREADY_ACTIVE",
    monitor_id: args.activation.monitor_id,
    monitoring_deadline: projected.monitoringDeadline,
    http_status: 200,
  };
}

/**
 * POST /v1/agent/start-monitoring orchestration. Accepts only
 * quote_id/connection_id/connection_token (+ the payment header) — every
 * other authoritative value (purchase, fingerprint, price, account) is
 * reloaded server-side from the durable quote/purchase rows.
 */
export async function startMonitoringForAgent(
  args: StartMonitoringArgs,
): Promise<StartMonitoringResult> {
  const now = args.now ?? new Date();
  const nowIso = now.toISOString();

  const auth = await authorizeAgentConnection({
    connectionId: args.connectionId,
    connectionToken: args.connectionToken,
    now,
    sqliteDb: args.sqliteDb,
    env: args.env,
  });
  if (!auth.ok) {
    return { ok: false, status: "ACTION_NOT_AUTHORIZED", http_status: 401 };
  }
  if (!auth.connection.account_id || !isAccountOwnerRef(auth.connection.account_id)) {
    return { ok: false, status: "ACTION_NOT_AUTHORIZED", http_status: 401 };
  }

  const store = await resolveStore(args.sqliteDb, args.env);

  const quote = await store.getMonitoringEnrollmentQuoteById(args.quoteId);
  // Quote ownership: connection_id alone never authorizes a quote it did not create.
  if (!quote || quote.connection_id !== args.connectionId) {
    return { ok: false, status: "ACTION_NOT_AUTHORIZED", http_status: 401 };
  }

  // Idempotency check first — a genuine replay of an already-consumed quote
  // must still succeed even though the quote itself is no longer 'issued'.
  const existingActivation = await store.getMonitorActivationByQuoteId(args.quoteId);
  if (existingActivation) {
    return resolveActivationResponse({
      activation: existingActivation,
      sqliteDb: args.sqliteDb,
      env: args.env,
      nowIso,
      firstTime: false,
    });
  }

  // No activation yet — the quote must still be genuinely payable.
  if (quote.status !== "issued") {
    return { ok: false, status: "CONNECTION_EXPIRED", http_status: 404 };
  }
  if (Date.parse(quote.expires_at) <= now.getTime()) {
    return { ok: false, status: "CONNECTION_EXPIRED", http_status: 404 };
  }
  if (Number(quote.price_amount) !== MONITORING_PRICE_USD || quote.price_currency !== "USD") {
    return { ok: false, status: "CONNECTION_EXPIRED", http_status: 404 };
  }

  const db = getWebDatabase();
  const purchaseRow = db
    .prepare(`SELECT * FROM purchases WHERE id = ?`)
    .get(quote.purchase_id) as Record<string, unknown> | undefined;
  if (!purchaseRow) {
    return { ok: false, status: "CONNECTION_EXPIRED", http_status: 404 };
  }
  if (String(purchaseRow.fingerprint_id ?? "") !== quote.fingerprint_id) {
    return { ok: false, status: "CONNECTION_EXPIRED", http_status: 404 };
  }
  if (String(purchaseRow.status) !== MONITORING_PAYMENT_READY_STATUS) {
    // Already active (or otherwise not in a payable pre-activation state) — fail closed.
    return { ok: false, status: "CONNECTION_EXPIRED", http_status: 404 };
  }

  let attempt = await store.getLatestPaymentAttemptForQuote(args.quoteId);
  if (!attempt || attempt.status === "failed" || attempt.status === "expired") {
    attempt = await store.insertPaymentAttempt({
      quoteId: args.quoteId,
      challengeRef: newId("x402ref"),
      now,
    });
  }

  const challenge = buildX402Challenge({
    resource: args.resource,
    quoteId: args.quoteId,
  });

  if (!args.paymentAuthorizationHeader) {
    return {
      ok: false,
      status: "PAYMENT_PENDING",
      challenge,
      challengeHeaderValue: encodeX402ChallengeHeader(challenge),
      http_status: 402,
    };
  }

  const verifier = resolveX402Verifier({ env: args.env, testVerifier: args.testVerifier });
  const verified = await verifier.verifyPayment({
    resource: args.resource,
    quoteId: args.quoteId,
    authorizationHeader: args.paymentAuthorizationHeader,
  });
  if (!verified.ok) {
    // Invalid/altered payment, or verification unavailable — never activates.
    return {
      ok: false,
      status: "PAYMENT_PENDING",
      challenge,
      challengeHeaderValue: encodeX402ChallengeHeader(challenge),
      http_status: 402,
    };
  }

  const activationId = newId("act");
  const activationKey = sha256Hex(
    [args.quoteId, verified.settlementRef, quote.purchase_id, quote.fingerprint_id].join("|"),
  );

  const saga = await store.recordSettledPaymentAndActivation({
    paymentAttemptId: attempt.id,
    quoteId: args.quoteId,
    settlementRef: verified.settlementRef,
    activationId,
    activationKey,
    purchaseId: quote.purchase_id,
    fingerprintId: quote.fingerprint_id,
    nowIso,
  });

  if (saga.outcome === "quote_not_issued") {
    // Defensive fallback only — the pre-checks above already require the
    // quote to be 'issued' and unexpired before reaching this point.
    return { ok: false, status: "CONNECTION_EXPIRED", http_status: 404 };
  }

  return resolveActivationResponse({
    activation: saga.activation,
    sqliteDb: args.sqliteDb,
    env: args.env,
    nowIso,
    firstTime: saga.outcome === "recorded",
  });
}

export interface ReconciliationResult {
  scanned: number;
  activated: number;
  still_pending: number;
}

/**
 * Retries projection for every durable activation still stuck at
 * `pending_projection` (a prior call recorded the settled payment but
 * crashed/failed before flipping the purchase to MONITORING_ACTIVE). Never
 * requests a new payment — only replays the already-recorded settlement.
 */
export async function reconcilePendingActivations(args: {
  now?: Date;
  sqliteDb?: NobuDatabase;
  env?: EnvRecord;
  limit?: number;
}): Promise<ReconciliationResult> {
  const now = args.now ?? new Date();
  const nowIso = now.toISOString();
  const store = await resolveStore(args.sqliteDb, args.env);
  const pending = await store.listPendingProjectionActivations();
  const batch = args.limit ? pending.slice(0, args.limit) : pending;

  let activated = 0;
  for (const activation of batch) {
    const projected = await projectActivation({
      purchaseId: activation.purchase_id,
      nowIso,
    });
    if (projected.ok) {
      await store.markMonitorActivationActive({
        activationId: activation.id,
        nowIso,
      });
      activated += 1;
    }
  }

  return {
    scanned: batch.length,
    activated,
    still_pending: batch.length - activated,
  };
}
