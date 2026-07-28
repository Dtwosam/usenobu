/**
 * Lane 8R.3B — the paid A2MCP service: one $0.99 Nobu Monitoring Pass.
 *
 * Why this exists. The previous paid endpoint (`/v1/agent/start-monitoring`)
 * only issued its x402 challenge *after* a caller already held a quote, a
 * verified connection, a confirmed product and recorded consent. A first-time
 * caller — including OKX's own validator — therefore got `400`/`401` instead
 * of `402`, and `agent x402-check` reported `valid: false`
 * (`docs/proof/lane-8r-3a-timeout-diagnosis/`).
 *
 * A pass decouples payment from enrollment. First contact needs nothing:
 * GET or POST, with or without a body, always returns the 402 challenge.
 * Redemption (free `REDEEM_MONITORING_PASS` on `/v1/agent`) is where every
 * identity, confirmation, eligibility and consent gate still applies —
 * unchanged, and a failed redemption never consumes the pass.
 *
 * Exactly-once issuance is anchored on the OKX-verified settlement
 * reference, never on anything the caller supplies:
 *   - `monitoring_passes.settlement_ref` is UNIQUE, so one verified
 *     settlement can only ever produce one pass;
 *   - a duplicate, concurrent, or lost-response replay of the same signed
 *     payment re-verifies to the same settlement reference and therefore
 *     resolves to the same pass;
 *   - a pending settlement is recorded against the sha256 digest of the
 *     replayed header (never the header itself) so it stays recoverable;
 *   - provider reconciliation polls official settle/status from the stored
 *     opaque settlement_ref alone — no signed-header replay and no second
 *     charge — so marketplace job completion can converge without the buyer
 *     replaying PAYMENT-SIGNATURE.
 */
import { randomBytes, randomUUID } from "node:crypto";
import type { NobuDatabase } from "../db/index.js";
import {
  getAuthStore,
  type AuthStore,
  type MonitoringPassPaymentRow,
  type MonitoringPassRow,
} from "../auth/auth-store.js";
import { sha256Hex } from "../auth/crypto.js";
import {
  buildX402Challenge,
  encodeX402ChallengeHeader,
  resolveX402Verifier,
  MONITORING_PRICE_USD,
  type X402Challenge,
  type X402Verifier,
} from "./x402.js";
import {
  createOkxSellerVerifier,
  type OkxSellerVerifyOutcome,
} from "./okx-seller-verifier.js";
import {
  isOkxSellerConfigured,
  loadOkxSellerConfig,
  OkxSellerClient,
  type OkxHttpFetch,
  type OkxSettleStatusResponse,
} from "./okx-seller-client.js";
import { buildConversationContract } from "../a2mcp/conversation-contract.js";

type EnvRecord = NodeJS.ProcessEnv | Record<string, string | undefined>;

/** Same-request settle/status poll after OKX returns pending (wall budget ~2.5s). */
const SETTLE_POLL_DELAYS_MS = [400, 800, 1200] as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Exact wording used in the challenge and in the issued-pass response. */
export const MONITORING_PASS_RESOURCE_DESCRIPTION =
  "One Nobu Monitoring Pass ($0.99). Redeemable once to activate price monitoring for one confirmed, eligible Target purchase. Payment does not guarantee a price drop, alert, refund, adjustment or savings.";

export const MONITORING_PASS_REDEEMABLE_FOR =
  "Activating monitoring for one confirmed eligible Target purchase via REDEEM_MONITORING_PASS on https://usenobu.vercel.app/v1/agent";

function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

/**
 * The durable schema retains a hash column from the original token-bearing
 * contract. New passes store a server-only random digest there, but no pass
 * token is returned or accepted. The public pass id now carries full UUID
 * entropy and redemption still requires the authorized connection + quote.
 */
function mintInternalPassSecretHash(): string {
  return sha256Hex(randomBytes(32).toString("base64url"));
}

/** Public pass ids carry full UUID entropy; no separate pass token is exposed. */
function newPassId(): string {
  return `pass_${randomUUID().replace(/-/g, "")}`;
}

async function resolveStore(
  sqliteDb?: NobuDatabase,
  env?: EnvRecord,
): Promise<AuthStore> {
  return getAuthStore({ sqliteDb, env });
}

export function buildMonitoringPassChallenge(args: {
  resource: string;
  env?: EnvRecord;
  payTo?: string | null;
}): X402Challenge {
  return buildX402Challenge({
    resource: args.resource,
    description: MONITORING_PASS_RESOURCE_DESCRIPTION,
    payTo: args.payTo,
    env: args.env,
  });
}

export interface MonitoringPassArgs {
  /** Raw PAYMENT-SIGNATURE header from the replay, or null on first contact. */
  paymentAuthorizationHeader: string | null;
  /** Absolute URL of this paid resource. */
  resource: string;
  now?: Date;
  sqliteDb?: NobuDatabase;
  env?: EnvRecord;
  /** Tests only — forbidden outside test mode by resolveX402Verifier. */
  testVerifier?: X402Verifier;
}

export type MonitoringPassResult =
  | {
      ok: true;
      status: "MONITORING_PASS_ISSUED";
      http_status: 200;
      pass: MonitoringPassRow;
      /** High-entropy handoff id for free RESOLVE_MONITORING_PASS. */
      pass_continuation_id: string;
    }
  | {
      ok: true;
      status: "PAYMENT_SETTLEMENT_PENDING";
      http_status: 200;
      note: string;
      pass_continuation_id: string;
    }
  | {
      ok: false;
      status: "PAYMENT_PENDING";
      http_status: 402;
      challenge: X402Challenge;
      challengeHeaderValue: string;
    };

function newContinuationId(): string {
  return `pass_cont_${randomUUID().replace(/-/g, "")}`;
}

async function ensureContinuation(
  store: AuthStore,
  paymentId: string,
  nowIso: string,
  monitoringPassId?: string | null,
): Promise<string> {
  const row = await store.ensureMonitoringPassContinuation({
    id: newContinuationId(),
    paymentId,
    monitoringPassId: monitoringPassId ?? null,
    status: monitoringPassId ? "issued" : "pending",
    nowIso,
  });
  return row.id;
}

function challengeResult(args: {
  resource: string;
  env?: EnvRecord;
}): MonitoringPassResult {
  const challenge = buildMonitoringPassChallenge({
    resource: args.resource,
    env: args.env,
  });
  return {
    ok: false,
    status: "PAYMENT_PENDING",
    http_status: 402,
    challenge,
    challengeHeaderValue: encodeX402ChallengeHeader(challenge),
  };
}

/**
 * Issues (or re-resolves) exactly one pass for a verified settlement.
 */
async function issuePassForSettlement(args: {
  store: AuthStore;
  settlementRef: string;
  paymentId: string;
  nowIso: string;
}): Promise<MonitoringPassResult> {
  const existing = await args.store.getMonitoringPassBySettlementRef(
    args.settlementRef,
  );
  if (existing) {
    const contId = await ensureContinuation(
      args.store,
      args.paymentId,
      args.nowIso,
      existing.id,
    );
    return {
      ok: true,
      status: "MONITORING_PASS_ISSUED",
      http_status: 200,
      pass: existing,
      pass_continuation_id: contId,
    };
  }

  const hash = mintInternalPassSecretHash();
  const issued = await args.store.issueMonitoringPass({
    id: newPassId(),
    passTokenHash: hash,
    settlementRef: args.settlementRef,
    paymentId: args.paymentId,
    priceAmount: MONITORING_PRICE_USD,
    priceCurrency: "USD",
    nowIso: args.nowIso,
  });

  const contId = await ensureContinuation(
    args.store,
    args.paymentId,
    args.nowIso,
    issued.pass.id,
  );

  return {
    ok: true,
    status: "MONITORING_PASS_ISSUED",
    http_status: 200,
    pass: issued.pass,
    pass_continuation_id: contId,
  };
}

/**
 * GET/POST `/v1/agent/monitoring-pass`.
 *
 * No quote, connection, purchase or consent is consulted before the
 * challenge is issued — first contact is a pure challenge build.
 */
export async function monitoringPassForAgent(
  args: MonitoringPassArgs,
): Promise<MonitoringPassResult> {
  const now = args.now ?? new Date();
  const nowIso = now.toISOString();

  // First contact — always 402, immediately, with no dependency touched.
  if (!args.paymentAuthorizationHeader) {
    return challengeResult({ resource: args.resource, env: args.env });
  }

  const store = await resolveStore(args.sqliteDb, args.env);
  const authorizationDigest = sha256Hex(args.paymentAuthorizationHeader);

  // A repeated replay of the same signed payment must not settle twice.
  const priorPayment =
    await store.getMonitoringPassPaymentByDigest(authorizationDigest);
  if (priorPayment?.status === "settled" && priorPayment.settlement_ref) {
    return issuePassForSettlement({
      store,
      settlementRef: priorPayment.settlement_ref,
      paymentId: priorPayment.id,
      nowIso,
    });
  }
  if (priorPayment?.status === "verifying" && priorPayment.settlement_ref) {
    return resumePendingPassSettlement({
      store,
      payment: priorPayment,
      resource: args.resource,
      env: args.env,
      nowIso,
    });
  }

  const payment = await store.upsertMonitoringPassPayment({
    id: newId("pass_pay"),
    authorizationDigest,
    nowIso,
  });

  let settlementRef: string | null = null;
  let pendingTxHash: string | null = null;

  if (args.testVerifier) {
    const verifier = resolveX402Verifier({
      env: args.env,
      testVerifier: args.testVerifier,
    });
    const verified = await verifier.verifyPayment({
      resource: args.resource,
      authorizationHeader: args.paymentAuthorizationHeader,
    });
    if (!verified.ok) {
      await store.updateMonitoringPassPayment({
        id: payment.id,
        status: "failed",
        settlementRef: null,
        nowIso,
      });
      return challengeResult({ resource: args.resource, env: args.env });
    }
    settlementRef = verified.settlementRef;
  } else if (isOkxSellerConfigured(args.env ?? process.env)) {
    const seller = createOkxSellerVerifier({ env: args.env });
    const detailed: OkxSellerVerifyOutcome =
      await seller.verifyAndSettleDetailed({
        resource: args.resource,
        authorizationHeader: args.paymentAuthorizationHeader,
      });
    if (detailed.ok) {
      settlementRef = detailed.settlementRef;
    } else if (
      detailed.reason === "settlement_pending" &&
      detailed.pendingTxHash
    ) {
      pendingTxHash = detailed.pendingTxHash;
    } else {
      await store.updateMonitoringPassPayment({
        id: payment.id,
        status: "failed",
        settlementRef: null,
        nowIso,
      });
      return challengeResult({ resource: args.resource, env: args.env });
    }
  } else {
    // No seller credentials — fail closed, never invent a settlement.
    await store.updateMonitoringPassPayment({
      id: payment.id,
      status: "failed",
      settlementRef: null,
      nowIso,
    });
    return challengeResult({ resource: args.resource, env: args.env });
  }

  if (pendingTxHash) {
    await store.updateMonitoringPassPayment({
      id: payment.id,
      status: "verifying",
      settlementRef: pendingTxHash,
      nowIso,
    });
    // Bounded same-request settle/status poll so marketplace users receive a
    // pass automatically when confirmation is already available — without
    // owner intervention or a second payment challenge.
    const polled = await pollPendingSettlementToPass({
      store,
      paymentId: payment.id,
      env: args.env,
      nowIso,
    });
    if (polled) return polled;

    const contId = await ensureContinuation(store, payment.id, nowIso);
    return {
      ok: true,
      status: "PAYMENT_SETTLEMENT_PENDING",
      http_status: 200,
      pass_continuation_id: contId,
      note: "Settlement submitted; awaiting on-chain confirmation. No pass is issued until it confirms. Do not pay again — use free RESOLVE_MONITORING_PASS with the same pass_continuation_id. Nobu will converge automatically; do not open a second payment.",
    };
  }

  if (!settlementRef) {
    return challengeResult({ resource: args.resource, env: args.env });
  }

  await store.updateMonitoringPassPayment({
    id: payment.id,
    status: "settled",
    settlementRef,
    nowIso,
  });

  return issuePassForSettlement({
    store,
    settlementRef,
    paymentId: payment.id,
    nowIso,
  });
}

/**
 * Polls the official settle-status API for a settlement that was already
 * submitted. Never re-verifies or re-charges — it only reads the outcome of
 * the payment already recorded against this authorization digest / payment id.
 */
async function resumePendingPassSettlement(args: {
  store: AuthStore;
  payment: { id: string; settlement_ref: string | null };
  resource: string;
  env?: EnvRecord;
  nowIso: string;
  fetchImpl?: OkxHttpFetch;
}): Promise<MonitoringPassResult> {
  const outcome = await confirmPendingPassPayment({
    store: args.store,
    payment: args.payment,
    env: args.env,
    nowIso: args.nowIso,
    fetchImpl: args.fetchImpl,
  });

  if (outcome.kind === "issued") {
    const contId = await ensureContinuation(
      args.store,
      args.payment.id,
      args.nowIso,
      outcome.pass.id,
    );
    return {
      ok: true,
      status: "MONITORING_PASS_ISSUED",
      http_status: 200,
      pass: outcome.pass,
      pass_continuation_id: contId,
    };
  }
  if (outcome.kind === "failed") {
    return challengeResult({ resource: args.resource, env: args.env });
  }
  const contId = await ensureContinuation(
    args.store,
    args.payment.id,
    args.nowIso,
  );
  return {
    ok: true,
    status: "PAYMENT_SETTLEMENT_PENDING",
    http_status: 200,
    pass_continuation_id: contId,
    note: outcome.note,
  };
}

/**
 * Hot-path automatic convergence after settle returns pending.
 * Polls settle/status a few times with short delays; issues one pass if
 * confirmed. Never re-charges. Returns null if still pending after budget.
 */
async function pollPendingSettlementToPass(args: {
  store: AuthStore;
  paymentId: string;
  env?: EnvRecord;
  nowIso: string;
  fetchImpl?: OkxHttpFetch;
  delaysMs?: readonly number[];
}): Promise<MonitoringPassResult | null> {
  const delays = args.delaysMs ?? SETTLE_POLL_DELAYS_MS;
  for (let i = 0; i < delays.length; i += 1) {
    if (delays[i]! > 0) {
      await sleep(delays[i]!);
    }
    const payment = await args.store.getMonitoringPassPaymentById(
      args.paymentId,
    );
    if (!payment) return null;
    const outcome = await confirmPendingPassPayment({
      store: args.store,
      payment,
      env: args.env,
      nowIso: args.nowIso,
      fetchImpl: args.fetchImpl,
    });
    if (outcome.kind === "issued") {
      const contId = await ensureContinuation(
        args.store,
        args.paymentId,
        args.nowIso,
        outcome.pass.id,
      );
      return {
        ok: true,
        status: "MONITORING_PASS_ISSUED",
        http_status: 200,
        pass: outcome.pass,
        pass_continuation_id: contId,
      };
    }
    if (outcome.kind === "failed") return null;
  }
  return null;
}

/**
 * Confirm one payment by id only (continuation hot path). Does not scan
 * unrelated verifying rows.
 */
export async function confirmPaymentById(args: {
  paymentId: string;
  now?: Date;
  sqliteDb?: NobuDatabase;
  env?: EnvRecord;
  fetchImpl?: OkxHttpFetch;
}): Promise<{
  kind: "issued" | "pending" | "failed" | "not_found";
  pass?: MonitoringPassRow;
  note?: string;
}> {
  const nowIso = (args.now ?? new Date()).toISOString();
  const store = await resolveStore(args.sqliteDb, args.env);
  const payment = await store.getMonitoringPassPaymentById(args.paymentId);
  if (!payment) return { kind: "not_found" };
  const outcome = await confirmPendingPassPayment({
    store,
    payment,
    env: args.env,
    nowIso,
    fetchImpl: args.fetchImpl,
  });
  if (outcome.kind === "issued") {
    await ensureContinuation(store, payment.id, nowIso, outcome.pass.id);
    return { kind: "issued", pass: outcome.pass };
  }
  if (outcome.kind === "failed") return { kind: "failed" };
  await ensureContinuation(store, payment.id, nowIso);
  return { kind: "pending", note: outcome.note };
}

type ConfirmPendingOutcome =
  | { kind: "issued"; pass: MonitoringPassRow }
  | { kind: "pending"; note: string }
  | { kind: "failed" };

/**
 * Confirm one already-submitted settlement from its durable pending record.
 * Uses only the stored opaque settlement_ref + official settle/status.
 * Never re-reads a payment header and never creates a second challenge.
 */
async function confirmPendingPassPayment(args: {
  store: AuthStore;
  payment: { id: string; settlement_ref: string | null; status?: string };
  env?: EnvRecord;
  nowIso: string;
  fetchImpl?: OkxHttpFetch;
}): Promise<ConfirmPendingOutcome> {
  const pendingTxHash = String(args.payment.settlement_ref || "").trim();
  if (!pendingTxHash) {
    return {
      kind: "pending",
      note: "Settlement still pending confirmation.",
    };
  }

  const existingByRef =
    await args.store.getMonitoringPassBySettlementRef(pendingTxHash);
  if (existingByRef) {
    // Ensure the payment row is marked settled if a pass already exists.
    if (args.payment.status !== "settled") {
      await args.store.updateMonitoringPassPayment({
        id: args.payment.id,
        status: "settled",
        settlementRef: pendingTxHash,
        nowIso: args.nowIso,
      });
    }
    return { kind: "issued", pass: existingByRef };
  }

  // Already settled in durable storage but pass insert never completed.
  if (args.payment.status === "settled") {
    const issued = await issuePassForSettlement({
      store: args.store,
      settlementRef: pendingTxHash,
      paymentId: args.payment.id,
      nowIso: args.nowIso,
    });
    if (issued.ok && issued.status === "MONITORING_PASS_ISSUED") {
      return { kind: "issued", pass: issued.pass };
    }
    return {
      kind: "pending",
      note: "Settlement recorded; Monitoring Pass issuance still completing.",
    };
  }

  const cfg = loadOkxSellerConfig(args.env ?? process.env);
  if (!cfg) {
    return {
      kind: "pending",
      note: "Settlement still pending confirmation.",
    };
  }

  let status: OkxSettleStatusResponse;
  try {
    const client = new OkxSellerClient(cfg, args.fetchImpl);
    status = await client.getSettleStatus(pendingTxHash);
  } catch {
    return {
      kind: "pending",
      note: "Settlement status unavailable; still not payment complete.",
    };
  }

  if (status.status === "pending" || (!status.success && !status.status)) {
    return {
      kind: "pending",
      note: "Settlement still pending confirmation.",
    };
  }
  if (status.status === "failed" || status.success === false) {
    await args.store.updateMonitoringPassPayment({
      id: args.payment.id,
      status: "failed",
      settlementRef: null,
      nowIso: args.nowIso,
    });
    return { kind: "failed" };
  }

  const settlementRef = String(status.transaction || pendingTxHash).trim();
  await args.store.updateMonitoringPassPayment({
    id: args.payment.id,
    status: "settled",
    settlementRef,
    nowIso: args.nowIso,
  });
  const issued = await issuePassForSettlement({
    store: args.store,
    settlementRef,
    paymentId: args.payment.id,
    nowIso: args.nowIso,
  });
  if (issued.ok && issued.status === "MONITORING_PASS_ISSUED") {
    return { kind: "issued", pass: issued.pass };
  }
  return {
    kind: "pending",
    note: "Settlement confirmed; Monitoring Pass issuance still completing.",
  };
}

export type PassSettlementReconciliationResult = {
  scanned: number;
  issued: number;
  still_pending: number;
  failed: number;
  /** Public pass ids only — never tokens, digests, headers, or settlement refs. */
  issued_pass_ids: string[];
  /** Continuations created/linked for settled historical payments. */
  continuations_backfilled: number;
};

/**
 * Provider-controlled recovery for marketplace-completed payments that
 * returned `PAYMENT_SETTLEMENT_PENDING` and never received a signed replay.
 *
 * Scans durable verifying (and settled-without-pass) Monitoring Pass payment
 * rows, polls official settle/status using only the stored opaque tx hash,
 * and issues exactly one pass per confirmed settlement. Concurrent and
 * repeated runs cannot duplicate issuance (UNIQUE settlement_ref) and never
 * create a second payment challenge.
 */
export async function reconcilePendingPassSettlements(args: {
  now?: Date;
  sqliteDb?: NobuDatabase;
  env?: EnvRecord;
  limit?: number;
  /** Tests only — inject settle/status HTTP. Never used to replay payment. */
  fetchImpl?: OkxHttpFetch;
} = {}): Promise<PassSettlementReconciliationResult> {
  const now = args.now ?? new Date();
  const nowIso = now.toISOString();
  const store = await resolveStore(args.sqliteDb, args.env);

  const verifying = await store.listVerifyingMonitoringPassPayments();
  const settledOrphan =
    await store.listSettledMonitoringPassPaymentsWithoutPass();

  // Prefer verifying rows; then crash-recovery settled-without-pass rows.
  // Deduplicate by payment id so a row cannot be processed twice in one run.
  const seen = new Set<string>();
  const batch: MonitoringPassPaymentRow[] = [];
  for (const row of [...verifying, ...settledOrphan]) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    batch.push(row);
  }
  const limited = args.limit ? batch.slice(0, args.limit) : batch;

  let issued = 0;
  let stillPending = 0;
  let failed = 0;
  const issuedPassIds: string[] = [];

  for (const payment of limited) {
    const outcome = await confirmPendingPassPayment({
      store,
      payment,
      env: args.env,
      nowIso,
      fetchImpl: args.fetchImpl,
    });
    if (outcome.kind === "issued") {
      issued += 1;
      issuedPassIds.push(outcome.pass.id);
      await ensureContinuation(store, payment.id, nowIso, outcome.pass.id);
    } else if (outcome.kind === "failed") {
      failed += 1;
    } else {
      stillPending += 1;
      if (payment.settlement_ref) {
        await ensureContinuation(store, payment.id, nowIso);
      }
    }
  }

  // Historical backfill: settled+pass rows created before continuations existed.
  let continuationsBackfilled = 0;
  const missing = await store.listSettledPassPaymentsMissingContinuation();
  for (const payment of missing) {
    const pass = await store.getMonitoringPassByPaymentId(payment.id);
    if (!pass) continue;
    await ensureContinuation(store, payment.id, nowIso, pass.id);
    continuationsBackfilled += 1;
  }

  return {
    scanned: limited.length,
    issued,
    still_pending: stillPending,
    failed,
    issued_pass_ids: issuedPassIds,
    continuations_backfilled: continuationsBackfilled,
  };
}

/**
 * Response body shapes — never include settlement reference, digest, or
 * payment header. Exposes both custom journey fields and the
 * `fields`/`requiredArgs` names official Onchain OS 4.4.0 reads from
 * endpoint bodies after payment replay.
 */
export function monitoringPassResponseBody(
  result: MonitoringPassResult,
): Record<string, unknown> {
  if (result.ok && result.status === "MONITORING_PASS_ISSUED") {
    const contract = buildConversationContract({
      status: "MONITORING_PASS_ISSUED",
      completed_step: "MONITORING_PASS_ISSUED",
      next_action: "UNDERSTAND_PURCHASE",
      message:
        "Your Monitoring Pass is ready. No additional payment is required. Continue with free Purchase Setup on service 33561.",
      guidance:
        "Do not request another payment. Ask if the user wants to use the pass now. If yes, collect only the recent Target purchase description — do not ask for email or consent yet. Redeem later after preflight with this monitoring_pass_id.",
      payment_status: "recognized",
      second_payment_required: false,
      monitoring_active: false,
      journey_complete: false,
      retry_safe: true,
      required_fields: ["purchase_text"],
      pass_continuation_id: result.pass_continuation_id,
      monitoring_pass_id: result.pass.id,
      next_service_id: 33561,
    });
    return {
      agent_state: "MONITORING_PASS",
      ...contract,
      monitoring_pass_id: result.pass.id,
      pass_continuation_id: result.pass_continuation_id,
      price_amount: result.pass.price_amount,
      price_currency: result.pass.price_currency,
      redeemable_for: MONITORING_PASS_REDEEMABLE_FOR,
      required_purchase_input: [
        "purchase_text",
        "purchase_price",
        "purchase_date",
      ],
    };
  }

  if (result.ok) {
    const contract = buildConversationContract({
      status: "PAYMENT_SETTLEMENT_PENDING",
      completed_step: "PAYMENT_SUBMITTED",
      next_action: "RESOLVE_MONITORING_PASS",
      message: result.note,
      guidance:
        "Settlement is still confirming. Keep pass_continuation_id and call RESOLVE_MONITORING_PASS on free service 33561 shortly. Do not pay again and do not invent other status checks.",
      payment_status: "pending",
      second_payment_required: false,
      monitoring_active: false,
      journey_complete: false,
      retry_safe: true,
      required_fields: ["pass_continuation_id"],
      pass_continuation_id: result.pass_continuation_id,
      next_service_id: 33561,
    });
    return {
      agent_state: "MONITORING_PASS",
      ...contract,
      pass_continuation_id: result.pass_continuation_id,
    };
  }

  const contract = buildConversationContract({
    status: "PAYMENT_PENDING",
    completed_step: "MONITORING_PASS_EXPLAINED",
    next_action: "REPLAY_WITH_PAYMENT-SIGNATURE",
    message:
      "The $0.99 payment buys one Monitoring Pass only. It does not start monitoring. Pay the challenge once and replay this request with PAYMENT-SIGNATURE to receive the pass.",
    guidance:
      "Present the x402 challenge. After payment, replay this endpoint with the PAYMENT-SIGNATURE header. Then continue free Purchase Setup on service 33561. Never guarantee a refund or price adjustment.",
    payment_status: "required",
    second_payment_required: false,
    monitoring_active: false,
    journey_complete: false,
    retry_safe: true,
    required_fields: null,
    required_user_input: {
      description:
        "Complete the x402 payment once, then replay with PAYMENT-SIGNATURE.",
    },
    next_service_id: 35958,
  });
  return {
    ...contract,
    x402Version: result.challenge.x402Version,
    resource: result.challenge.resource,
    accepts: result.challenge.accepts,
  };
}
/**
 * Free-service resolution of a Monitoring Pass by continuation id or public
 * pass id. Unknown/guessed ids fail closed with a generic not-found shape.
 * Never returns digests, settlement refs, headers, or pass tokens.
 */
export async function resolveMonitoringPassForAgent(args: {
  passContinuationId?: string | null;
  monitoringPassId?: string | null;
  now?: Date;
  sqliteDb?: NobuDatabase;
  env?: EnvRecord;
  /** Tests only — inject settle/status HTTP. */
  fetchImpl?: OkxHttpFetch;
}): Promise<{
  http_status: number;
  body: Record<string, unknown>;
}> {
  const nowIso = (args.now ?? new Date()).toISOString();
  const contId = String(args.passContinuationId || "").trim();
  const passId = String(args.monitoringPassId || "").trim();
  const genericMissing = {
    agent_state: "MONITORING_PASS",
    ...buildConversationContract({
      status: "MONITORING_PASS_NOT_FOUND",
      completed_step: "MONITORING_PASS_LOOKUP",
      next_action: "UNDERSTAND_PURCHASE",
      message:
        "No Monitoring Pass was found for that reference. Do not invent a payment or status-check option.",
      guidance:
        "If the user just paid, wait briefly and retry RESOLVE_MONITORING_PASS with the same pass_continuation_id. Otherwise buy one Monitoring Pass on service 35958 once, or start free Purchase Setup only after they confirm they have a pass.",
      payment_status: "required",
      second_payment_required: false,
      monitoring_active: false,
      journey_complete: false,
      retry_safe: true,
      required_fields: ["purchase_text"],
      next_service_id: 33561,
    }),
  };

  if ((!contId && !passId) || (contId && passId)) {
    return {
      http_status: 400,
      body: {
        error: "invalid_input",
        status: "invalid_input",
        message:
          "Provide exactly one of pass_continuation_id or monitoring_pass_id.",
        fields: ["action", "pass_continuation_id"],
        requiredArgs: ["action", "pass_continuation_id"],
      },
    };
  }

  const store = await resolveStore(args.sqliteDb, args.env);
  let continuation = contId
    ? await store.getMonitoringPassContinuationById(contId)
    : await store.getMonitoringPassContinuationByPassId(passId);

  // Historical issued pass without a continuation yet: allow public pass id
  // lookup and backfill exactly one continuation (still not a bearer for redeem).
  if (!continuation && passId) {
    const pass = await store.getMonitoringPassById(passId);
    if (pass && pass.status === "issued") {
      continuation = await store.ensureMonitoringPassContinuation({
        id: newContinuationId(),
        paymentId: pass.payment_id,
        monitoringPassId: pass.id,
        status: "issued",
        nowIso,
      });
    }
  }

  if (!continuation) {
    return { http_status: 404, body: genericMissing };
  }

  if (continuation.status === "issued" && continuation.monitoring_pass_id) {
    const pass = await store.getMonitoringPassById(
      continuation.monitoring_pass_id,
    );
    if (pass && (pass.status === "issued" || pass.status === "redeemed")) {
      return {
        http_status: 200,
        body: {
          agent_state: "MONITORING_PASS",
          ...buildConversationContract({
            status: "MONITORING_PASS_ISSUED",
            completed_step: "MONITORING_PASS_ISSUED",
            next_action: "UNDERSTAND_PURCHASE",
            message:
              "Your Monitoring Pass is ready. Would you like to use it now to monitor a recent Target purchase?",
            guidance:
              "No second payment is required. After the user says yes, call UNDERSTAND_PURCHASE with purchase_text only. Do not ask for email or consent until product confirmation. Redeem later with this monitoring_pass_id after preflight.",
            payment_status: "recognized",
            second_payment_required: false,
            monitoring_active: false,
            journey_complete: false,
            retry_safe: true,
            required_fields: ["purchase_text"],
            monitoring_pass_id: pass.id,
            pass_continuation_id: continuation.id,
            next_service_id: 33561,
          }),
          pass_status: pass.status,
        },
      };
    }
  }

  // Pending/partial: confirm THIS payment only — never scan unrelated rows.
  const payment = await store.getMonitoringPassPaymentById(
    continuation.payment_id,
  );
  if (payment) {
    const outcome = await confirmPendingPassPayment({
      store,
      payment,
      env: args.env,
      nowIso,
      fetchImpl: args.fetchImpl,
    });
    if (outcome.kind === "issued") {
      await ensureContinuation(
        store,
        payment.id,
        nowIso,
        outcome.pass.id,
      );
      return resolveMonitoringPassForAgent({
        passContinuationId: continuation.id,
        sqliteDb: args.sqliteDb,
        env: args.env,
        now: args.now,
        fetchImpl: args.fetchImpl,
      });
    }
  }

  return {
    http_status: 200,
    body: {
      agent_state: "MONITORING_PASS",
      ...buildConversationContract({
        status: "PAYMENT_SETTLEMENT_PENDING",
        completed_step: "PAYMENT_SUBMITTED",
        next_action: "RESOLVE_MONITORING_PASS",
        message:
          "Settlement is still confirming. Your Monitoring Pass is not ready yet. Do not pay again.",
        guidance:
          "Keep the pass_continuation_id and call RESOLVE_MONITORING_PASS again shortly. Nobu will issue the pass automatically when confirmation arrives. Do not invent other status checks or request email yet.",
        payment_status: "pending",
        second_payment_required: false,
        monitoring_active: false,
        journey_complete: false,
        retry_safe: true,
        required_fields: ["pass_continuation_id"],
        pass_continuation_id: continuation.id,
        next_service_id: 33561,
      }),
    },
  };
}
