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

type EnvRecord = NodeJS.ProcessEnv | Record<string, string | undefined>;

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
    }
  | {
      ok: true;
      status: "PAYMENT_SETTLEMENT_PENDING";
      http_status: 200;
      note: string;
    }
  | {
      ok: false;
      status: "PAYMENT_PENDING";
      http_status: 402;
      challenge: X402Challenge;
      challengeHeaderValue: string;
    };

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
    return {
      ok: true,
      status: "MONITORING_PASS_ISSUED",
      http_status: 200,
      pass: existing,
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

  return {
    ok: true,
    status: "MONITORING_PASS_ISSUED",
    http_status: 200,
    pass: issued.pass,
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
    return {
      ok: true,
      status: "PAYMENT_SETTLEMENT_PENDING",
      http_status: 200,
      note: "Settlement submitted; awaiting on-chain confirmation. No pass is issued until it confirms. Do not pay again — provider reconciliation will issue the pass once settle/status confirms.",
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
    return {
      ok: true,
      status: "MONITORING_PASS_ISSUED",
      http_status: 200,
      pass: outcome.pass,
    };
  }
  if (outcome.kind === "failed") {
    return challengeResult({ resource: args.resource, env: args.env });
  }
  return {
    ok: true,
    status: "PAYMENT_SETTLEMENT_PENDING",
    http_status: 200,
    note: outcome.note,
  };
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
    } else if (outcome.kind === "failed") {
      failed += 1;
    } else {
      stillPending += 1;
    }
  }

  return {
    scanned: limited.length,
    issued,
    still_pending: stillPending,
    failed,
    issued_pass_ids: issuedPassIds,
  };
}

/** Response body shapes — never include the settlement reference or digest. */
export function monitoringPassResponseBody(
  result: MonitoringPassResult,
): Record<string, unknown> {
  if (result.ok && result.status === "MONITORING_PASS_ISSUED") {
    return {
      agent_state: "MONITORING_PASS",
      status: "MONITORING_PASS_ISSUED",
      completed_step: "MONITORING_PASS_ISSUED",
      monitoring_active: false,
      journey_complete: false,
      monitoring_pass_id: result.pass.id,
      price_amount: Number(result.pass.price_amount),
      price_currency: result.pass.price_currency,
      redeemable_for: MONITORING_PASS_REDEEMABLE_FOR,
      next_action: "UNDERSTAND_PURCHASE",
      next_service_id: 33561,
      required_purchase_input: ["purchase_text", "purchase_price", "purchase_date", "Target online product details"],
      required_user_input: {
        action: "UNDERSTAND_PURCHASE",
        required_fields: ["purchase_text"],
        description: "A plain-English description of the recent Target online purchase.",
      },
      guidance:
        "Your $0.99 purchase issued a Monitoring Pass only; monitoring has not started. Continue with free service 33561: provide purchase details, confirm the exact product, verify email, give both consents, run preflight, then redeem this pass by monitoring_pass_id.",
      message:
        "Monitoring Pass issued. Monitoring is not active and no price drop, alert, savings, refund or adjustment is guaranteed.",
      documentation: "https://www.usenobu.xyz/okx",
    };
  }

  if (result.ok) {
    return {
      agent_state: "MONITORING_PASS",
      status: "PAYMENT_SETTLEMENT_PENDING",
      completed_step: "PAYMENT_SUBMITTED",
      monitoring_active: false,
      journey_complete: false,
      message: result.note,
      next_action:
        "Wait for provider settlement reconciliation. Do not pay again. A signed-header replay is optional recovery only.",
      required_user_input: {
        action: "WAIT_FOR_SETTLEMENT_CONFIRMATION",
        required_fields: [],
      },
      guidance:
        "Settlement is not confirmed yet, so no Monitoring Pass has been issued and monitoring is not active. Nobu reconciles from the durable pending settlement record via official settle/status without a second charge.",
      documentation: "https://www.usenobu.xyz/okx",
    };
  }

  return {
    agent_state: "MONITORING_PASS",
    status: "PAYMENT_PENDING",
    completed_step: "MONITORING_PASS_EXPLAINED",
    monitoring_active: false,
    journey_complete: false,
    x402Version: result.challenge.x402Version,
    resource: result.challenge.resource,
    accepts: result.challenge.accepts,
    message:
      "The $0.99 payment buys one Monitoring Pass only. It does not start monitoring. Pay the challenge and replay this request to receive the pass.",
    next_action:
      "Sign the PAYMENT-REQUIRED challenge and replay this request with the PAYMENT-SIGNATURE header.",
    required_user_input: {
      action: "PAY_FOR_MONITORING_PASS",
      required_fields: ["valid OKX x402 signed payment replay"],
    },
    guidance:
      "After the pass is issued, continue with free Purchase Setup service 33561. Monitoring begins only after successful pass redemption.",
    documentation: "https://www.usenobu.xyz/okx",
  };
}
