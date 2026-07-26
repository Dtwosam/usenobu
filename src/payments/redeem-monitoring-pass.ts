/**
 * Lane 8R.3B — free action `REDEEM_MONITORING_PASS`.
 *
 * This is where every gate that the paid endpoint deliberately no longer
 * enforces still applies, unchanged from Lane 7.4D:
 *   - a valid, unused pass (id + one-time token, still `issued`);
 *   - an authorized connection (handle + secret token);
 *   - a valid enrollment quote this connection created, still issued and
 *     unexpired, at the locked $0.99 / USD terms;
 *   - a confirmed exact product (purchase fingerprint still matches the
 *     quote's locked fingerprint);
 *   - current Target eligibility (purchase still MONITORING_PAYMENT_READY —
 *     PREFLIGHT_MONITORING only reaches that state after the deterministic
 *     policy/window check passes);
 *   - monitoring and email-alert consent (durably recorded on the quote
 *     before it was ever minted);
 *   - no conflicting activation.
 *
 * Any failed validation returns before the redemption transaction, so the
 * pass is never consumed. The pass is consumed and the activation inserted
 * in one atomic AuthStore transaction; projection and reconciliation reuse
 * the existing Lane 7.4D saga rather than a parallel one.
 */
import { randomUUID } from "node:crypto";
import { getWebDatabase } from "../web/db.js";
import type { NobuDatabase } from "../db/index.js";
import { MONITORING_PAYMENT_READY_STATUS } from "../matching/store.js";
import {
  getAuthStore,
  isAccountOwnerRef,
  type AuthStore,
} from "../auth/auth-store.js";
import { authorizeAgentConnection } from "../auth/agent-connections.js";
import { sha256Hex } from "../auth/crypto.js";
import { MONITORING_PRICE_USD } from "./x402.js";
import {
  projectActivation,
  resolveActivationResponse,
} from "./start-monitoring-service.js";

type EnvRecord = NodeJS.ProcessEnv | Record<string, string | undefined>;

function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export interface RedeemMonitoringPassArgs {
  monitoringPassId: string;
  monitoringPassToken: string;
  quoteId: string;
  connectionId: string;
  connectionToken: string;
  now?: Date;
  sqliteDb?: NobuDatabase;
  env?: EnvRecord;
}

export type RedeemMonitoringPassResult =
  | {
      ok: true;
      status: "MONITORING_STARTED" | "ALREADY_ACTIVE";
      http_status: 200;
      monitor_id: string;
      monitoring_deadline: string | null;
    }
  | {
      ok: true;
      status: "ACTIVATION_PENDING";
      http_status: 200;
      monitor_id: string;
    }
  | { ok: false; status: "ACTION_NOT_AUTHORIZED"; http_status: 401 }
  | { ok: false; status: "PASS_NOT_REDEEMABLE"; http_status: 400 }
  | { ok: false; status: "CONNECTION_EXPIRED"; http_status: 404 };

async function resolveStore(
  sqliteDb?: NobuDatabase,
  env?: EnvRecord,
): Promise<AuthStore> {
  return getAuthStore({ sqliteDb, env });
}

export async function redeemMonitoringPassForAgent(
  args: RedeemMonitoringPassArgs,
): Promise<RedeemMonitoringPassResult> {
  const now = args.now ?? new Date();
  const nowIso = now.toISOString();

  // --- Gate 1: authorized connection (handle alone is never authorization) ---
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
  if (
    !auth.connection.account_id ||
    !isAccountOwnerRef(auth.connection.account_id)
  ) {
    return { ok: false, status: "ACTION_NOT_AUTHORIZED", http_status: 401 };
  }

  const store = await resolveStore(args.sqliteDb, args.env);

  // --- Gate 2: the quote must belong to this connection ---
  const quote = await store.getMonitoringEnrollmentQuoteById(args.quoteId);
  if (!quote || quote.connection_id !== args.connectionId) {
    return { ok: false, status: "ACTION_NOT_AUTHORIZED", http_status: 401 };
  }

  // --- Gate 3: the pass must exist and its one-time token must match ---
  const pass = await store.getMonitoringPassById(args.monitoringPassId);
  if (!pass || pass.pass_token_hash !== sha256Hex(args.monitoringPassToken)) {
    // Unknown pass and wrong token are indistinguishable to the caller.
    return { ok: false, status: "ACTION_NOT_AUTHORIZED", http_status: 401 };
  }

  // --- No conflicting activation: a genuine replay resolves to the same monitor ---
  const existingActivation = await store.getMonitorActivationByQuoteId(
    args.quoteId,
  );
  if (existingActivation) {
    // Only the pass that actually redeemed this quote may replay it.
    if (
      existingActivation.monitoring_pass_id &&
      existingActivation.monitoring_pass_id !== pass.id
    ) {
      return { ok: false, status: "PASS_NOT_REDEEMABLE", http_status: 400 };
    }
    return toResult(
      await resolveActivationResponse({
        activation: existingActivation,
        sqliteDb: args.sqliteDb,
        env: args.env,
        nowIso,
        firstTime: false,
      }),
    );
  }

  if (pass.status !== "issued") {
    return { ok: false, status: "PASS_NOT_REDEEMABLE", http_status: 400 };
  }

  // --- Gate 4: the quote must still be genuinely redeemable ---
  if (quote.status !== "issued") {
    return { ok: false, status: "CONNECTION_EXPIRED", http_status: 404 };
  }
  if (Date.parse(quote.expires_at) <= now.getTime()) {
    return { ok: false, status: "CONNECTION_EXPIRED", http_status: 404 };
  }
  if (
    Number(quote.price_amount) !== MONITORING_PRICE_USD ||
    quote.price_currency !== "USD"
  ) {
    return { ok: false, status: "CONNECTION_EXPIRED", http_status: 404 };
  }

  // --- Gate 5: consent must have been durably recorded before the quote ---
  if (!quote.consent_monitoring_at || !quote.consent_email_alerts_at) {
    return { ok: false, status: "CONNECTION_EXPIRED", http_status: 404 };
  }

  // --- Gate 6: confirmed exact product + current Target eligibility ---
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
    return { ok: false, status: "CONNECTION_EXPIRED", http_status: 404 };
  }

  // --- Every gate passed: consume the pass and insert the activation atomically ---
  const activationId = newId("act");
  const activationKey = sha256Hex(
    [args.quoteId, pass.id, quote.purchase_id, quote.fingerprint_id].join("|"),
  );

  const saga = await store.redeemMonitoringPassAndActivate({
    passId: pass.id,
    quoteId: args.quoteId,
    activationId,
    activationKey,
    purchaseId: quote.purchase_id,
    fingerprintId: quote.fingerprint_id,
    nowIso,
  });

  if (saga.outcome === "pass_not_redeemable") {
    return { ok: false, status: "PASS_NOT_REDEEMABLE", http_status: 400 };
  }
  if (saga.outcome === "quote_not_issued") {
    return { ok: false, status: "CONNECTION_EXPIRED", http_status: 404 };
  }

  return toResult(
    await resolveActivationResponse({
      activation: saga.activation,
      sqliteDb: args.sqliteDb,
      env: args.env,
      nowIso,
      firstTime: saga.outcome === "recorded",
    }),
  );
}

/** Narrows the shared activation result to the statuses redemption can produce. */
function toResult(
  r: Awaited<ReturnType<typeof resolveActivationResponse>>,
): RedeemMonitoringPassResult {
  if (r.ok && r.status === "ACTIVATION_PENDING") {
    return {
      ok: true,
      status: "ACTIVATION_PENDING",
      http_status: 200,
      monitor_id: r.monitor_id,
    };
  }
  if (r.ok && (r.status === "MONITORING_STARTED" || r.status === "ALREADY_ACTIVE")) {
    return {
      ok: true,
      status: r.status,
      http_status: 200,
      monitor_id: r.monitor_id,
      monitoring_deadline: r.monitoring_deadline,
    };
  }
  return { ok: false, status: "CONNECTION_EXPIRED", http_status: 404 };
}

export { projectActivation };
