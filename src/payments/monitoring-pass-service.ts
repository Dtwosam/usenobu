/**
 * Paid A2MCP service: one $0.99 Nobu Monitoring Pass.
 *
 * Flow: unpaid 402 challenge → signed PAYMENT-SIGNATURE replay →
 * verify → settle (never issue before confirmed settlement) →
 * exactly one pass → secure free continuation credential.
 *
 * Exactly-once issuance is anchored on the OKX-verified settlement_ref
 * (UNIQUE). Ambiguous settle transport becomes settlement_unknown — never
 * a second challenge or automatic re-charge invitation.
 */
import { randomBytes, randomUUID } from "node:crypto";
import type { NobuDatabase } from "../db/index.js";
import {
  getAuthStore,
  type AuthStore,
  type MonitoringPassPaymentRow,
  type MonitoringPassPaymentStatus,
  type MonitoringPassRow,
} from "../auth/auth-store.js";
import { sha256Hex } from "../auth/crypto.js";
import {
  buildX402Challenge,
  buildX402ChallengeAsync,
  encodeX402ChallengeHeader,
  encodeX402PaymentResponseHeader,
  resolveX402Verifier,
  MONITORING_PRICE_USD,
  DEFAULT_SETTLEMENT_NETWORK,
  MONITORING_PRICE_ATOMIC_UNITS,
  X402_PAYMENT_HEADER_NAME,
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
import { extractProviderIds } from "./provider-ids.js";
import {
  FREE_SERVICE_ID,
  MONITORING_PASS_RESOURCE_DESCRIPTION as CATALOGUE_PASS_DESCRIPTION,
  PAID_SERVICE_ID,
  PAID_SERVICE_NAME,
  resolveFreeServiceEndpoint,
  buildPaidPrePaymentMachineFields,
} from "../a2mcp/service-catalogue.js";
import {
  buildAutomaticInteraction,
  buildPaidJourneyHandoffContinuation,
  buildUserInputInteraction,
} from "../a2mcp/protocol-continuation.js";
import {
  marketplaceIncompleteContract,
  marketplaceMonitoringActiveContract,
  type MarketplaceStage,
} from "../a2mcp/conversation-contract.js";
import { derivePassClaimCredential } from "./claim-credential.js";
import type { CanonicalPaymentRequirements } from "./canonical-requirements.js";
import type { MarketplacePurchaseJourneyRow } from "../auth/auth-store.js";

type EnvRecord = NodeJS.ProcessEnv | Record<string, string | undefined>;

/** Same-request settle/status poll after OKX returns pending (wall budget ~2.5s). */
const SETTLE_POLL_DELAYS_MS = [400, 800, 1200] as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const MONITORING_PASS_RESOURCE_DESCRIPTION = CATALOGUE_PASS_DESCRIPTION;

export function monitoringPassRedeemableFor(env?: EnvRecord): string {
  return `Activating monitoring for one confirmed eligible Target purchase via REDEEM_MONITORING_PASS on ${resolveFreeServiceEndpoint(env)}`;
}

/** @deprecated Use monitoringPassRedeemableFor(env) */
export const MONITORING_PASS_REDEEMABLE_FOR = monitoringPassRedeemableFor();

function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

function mintInternalPassSecretHash(): string {
  return sha256Hex(randomBytes(32).toString("base64url"));
}

function newPassId(): string {
  return `pass_${randomUUID().replace(/-/g, "")}`;
}

function newContinuationId(): string {
  return `pass_cont_${randomUUID().replace(/-/g, "")}`;
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

export async function buildMonitoringPassChallengeAsync(args: {
  resource: string;
  env?: EnvRecord;
  payTo?: string | null;
}): Promise<{
  challenge: X402Challenge;
  requirements: CanonicalPaymentRequirements;
}> {
  return buildX402ChallengeAsync({
    resource: args.resource,
    description: MONITORING_PASS_RESOURCE_DESCRIPTION,
    payTo: args.payTo,
    env: args.env,
  });
}

export interface MonitoringPassArgs {
  paymentAuthorizationHeader: string | null;
  resource: string;
  now?: Date;
  sqliteDb?: NobuDatabase;
  env?: EnvRecord;
  testVerifier?: X402Verifier;
  /** Injected OKX HTTP client (tests); Production uses real fetch. */
  fetchImpl?: OkxHttpFetch;
}

export type MonitoringPassResult =
  | {
      ok: true;
      status: "MONITORING_PASS_ISSUED";
      http_status: 200;
      pass: MonitoringPassRow;
      pass_continuation_id: string;
      /** Durable journey ensured at settlement (or recovered). */
      journey_id: string;
      journey_stage: string;
      settlementRef: string;
      payer?: string;
      payment_response_header: string;
    }
  | {
      ok: true;
      status: "MONITORING_PASS_DELIVERY_PENDING";
      http_status: 200;
      pass: MonitoringPassRow;
      pass_continuation_id: string;
      settlementRef: string;
      payer?: string;
      payment_response_header: string;
      note: string;
    }
  | {
      ok: true;
      status:
        | "PAYMENT_SETTLEMENT_PENDING"
        | "PAYMENT_SETTLEMENT_UNKNOWN"
        | "SETTLEMENT_REVIEW_REQUIRED";
      http_status: 200;
      note: string;
      pass_continuation_id: string;
      payment_response_header?: string;
      /** Safe operator reference only — never a payment signature. */
      operator_reference?: string;
    }
  | {
      ok: false;
      status: "PAYMENT_PENDING";
      http_status: 402;
      challenge: X402Challenge;
      challengeHeaderValue: string;
    }
  | {
      ok: false;
      status: "PAYMENT_REJECTED";
      http_status: 402;
      challenge: X402Challenge;
      challengeHeaderValue: string;
      sanitized_reason?: string;
    };

export type EnsureContinuationResult = {
  ok: true;
  id: string;
  /**
   * Historical only: raw claim credential when a hash is stored and unconsumed.
   * Never serialized into new paid public responses.
   */
  claimCredentialRaw?: string;
};

function newJourneyId(): string {
  return `journey_${randomUUID().replace(/-/g, "")}`;
}

/**
 * Concurrency-safe continuation row:
 * 1) insert/resolve unique continuation first with claim_credential_hash NULL;
 * 2) never derive or store a claim hash for newly created continuations;
 * 3) when a historical row already has a claim hash, re-derive the raw secret
 *    only for internal recovery (never serialized on new paid responses).
 *
 * New paid responses never expose pass_claim_credential.
 */
async function ensureContinuation(
  store: AuthStore,
  paymentId: string,
  nowIso: string,
  monitoringPassId?: string | null,
  env?: EnvRecord,
): Promise<EnsureContinuationResult> {
  const provisionalId = newContinuationId();
  // New continuations: claim_credential_hash and claim_credential_consumed_at stay null.
  // Do not derive or store claim credentials for new paid handoffs.
  let row = await store.ensureMonitoringPassContinuation({
    id: provisionalId,
    paymentId,
    monitoringPassId: monitoringPassId ?? null,
    status: monitoringPassId ? "issued" : "pending",
    claimCredentialHash: null,
    nowIso,
  });

  if (monitoringPassId) {
    row = await store.ensureMonitoringPassContinuation({
      id: row.id,
      paymentId,
      monitoringPassId,
      status: "issued",
      claimCredentialHash: null,
      nowIso,
    });
  }

  row = (await store.getMonitoringPassContinuationByPaymentId(paymentId))!;

  // Historical recovery only: if a pre-repair row already has a hash, re-derive
  // raw for callers that still use the claim path. Never write a new hash here.
  let claimCredentialRaw: string | undefined;
  if (row.claim_credential_hash && !row.claim_credential_consumed_at) {
    const verified = derivePassClaimCredential({
      paymentId,
      continuationId: row.id,
      env,
    });
    if (verified && verified.hash === row.claim_credential_hash) {
      claimCredentialRaw = verified.raw;
    }
  }

  return {
    ok: true,
    id: row.id,
    claimCredentialRaw,
  };
}

/**
 * Exactly one journey per monitoring_pass_id (idempotent ensure).
 * Never resets an advanced journey.
 */
async function ensureIssuedPassJourney(
  store: AuthStore,
  args: {
    monitoringPassId: string;
    passContinuationId: string;
    nowIso: string;
    env?: EnvRecord;
  },
): Promise<MarketplacePurchaseJourneyRow | null> {
  // Test-only: force delivery-pending path after pass + continuation succeed.
  // Requires NOBU_AUTH_TEST_MODE so Production never honors this.
  const env = args.env ?? process.env;
  if (
    String(env.NOBU_AUTH_TEST_MODE || "") === "1" &&
    String(env.NOBU_TEST_FORCE_JOURNEY_ENSURE_FAIL || "") === "1"
  ) {
    return null;
  }
  try {
    return await store.ensureMarketplacePurchaseJourney({
      id: newJourneyId(),
      monitoringPassId: args.monitoringPassId,
      passContinuationId: args.passContinuationId,
      nowIso: args.nowIso,
    });
  } catch {
    // Recover readable journey if a concurrent insert won or transient failure.
    try {
      return await store.getMarketplacePurchaseJourneyByPassId(
        args.monitoringPassId,
      );
    } catch {
      return null;
    }
  }
}

async function challengeResult(args: {
  resource: string;
  env?: EnvRecord;
  rejected?: boolean;
  sanitizedReason?: string;
}): Promise<MonitoringPassResult> {
  const { challenge } = await buildMonitoringPassChallengeAsync({
    resource: args.resource,
    env: args.env,
  });
  if (args.rejected) {
    return {
      ok: false,
      status: "PAYMENT_REJECTED",
      http_status: 402,
      challenge,
      challengeHeaderValue: encodeX402ChallengeHeader(challenge),
      sanitized_reason: args.sanitizedReason,
    };
  }
  return {
    ok: false,
    status: "PAYMENT_PENDING",
    http_status: 402,
    challenge,
    challengeHeaderValue: encodeX402ChallengeHeader(challenge),
  };
}

function safeReceipt(args: {
  success: boolean;
  transaction: string;
  payer?: string;
  status?: "pending" | "success" | "timeout";
}): string {
  return encodeX402PaymentResponseHeader({
    success: args.success,
    transaction: args.transaction,
    network: DEFAULT_SETTLEMENT_NETWORK,
    payer: args.payer,
    status: args.status,
    amount: MONITORING_PRICE_ATOMIC_UNITS,
  });
}

async function finalizeIssuedPassResult(args: {
  store: AuthStore;
  pass: MonitoringPassRow;
  paymentId: string;
  settlementRef: string;
  nowIso: string;
  payer?: string | null;
  env?: EnvRecord;
}): Promise<
  Extract<
    MonitoringPassResult,
    { status: "MONITORING_PASS_ISSUED" | "MONITORING_PASS_DELIVERY_PENDING" }
  >
> {
  const cont = await ensureContinuation(
    args.store,
    args.paymentId,
    args.nowIso,
    args.pass.id,
    args.env,
  );
  const receipt = safeReceipt({
    success: true,
    transaction: args.settlementRef,
    payer: args.payer ?? undefined,
    status: "success",
  });
  const journey = await ensureIssuedPassJourney(args.store, {
    monitoringPassId: args.pass.id,
    passContinuationId: cont.id,
    nowIso: args.nowIso,
    env: args.env,
  });
  if (!journey) {
    return {
      ok: true,
      status: "MONITORING_PASS_DELIVERY_PENDING",
      http_status: 200,
      pass: args.pass,
      pass_continuation_id: cont.id,
      settlementRef: args.settlementRef,
      payer: args.payer ?? args.pass.payer_address ?? undefined,
      payment_response_header: receipt,
      note: "Payment recognized and Monitoring Pass issued. Purchase Setup delivery is completing. Do not pay again.",
    };
  }
  return {
    ok: true,
    status: "MONITORING_PASS_ISSUED",
    http_status: 200,
    pass: args.pass,
    pass_continuation_id: cont.id,
    journey_id: journey.id,
    journey_stage: journey.stage,
    settlementRef: args.settlementRef,
    payer: args.payer ?? args.pass.payer_address ?? undefined,
    payment_response_header: receipt,
  };
}

async function issuePassForSettlement(args: {
  store: AuthStore;
  settlementRef: string;
  paymentId: string;
  nowIso: string;
  payer?: string | null;
  env?: EnvRecord;
}): Promise<MonitoringPassResult> {
  const existing = await args.store.getMonitoringPassBySettlementRef(
    args.settlementRef,
  );
  if (existing) {
    return finalizeIssuedPassResult({
      store: args.store,
      pass: existing,
      paymentId: args.paymentId,
      settlementRef: args.settlementRef,
      nowIso: args.nowIso,
      payer: args.payer ?? existing.payer_address,
      env: args.env,
    });
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
    payerAddress: args.payer ?? null,
  });

  return finalizeIssuedPassResult({
    store: args.store,
    pass: issued.pass,
    paymentId: args.paymentId,
    settlementRef: args.settlementRef,
    nowIso: args.nowIso,
    payer: args.payer,
    env: args.env,
  });
}

/**
 * GET/POST `/v1/agent/monitoring-pass`.
 * First contact is a pure challenge — no quote/connection/purchase.
 */
export async function monitoringPassForAgent(
  args: MonitoringPassArgs,
): Promise<MonitoringPassResult> {
  const now = args.now ?? new Date();
  const nowIso = now.toISOString();

  if (!args.paymentAuthorizationHeader) {
    return challengeResult({ resource: args.resource, env: args.env });
  }

  const store = await resolveStore(args.sqliteDb, args.env);
  const authorizationDigest = sha256Hex(args.paymentAuthorizationHeader);

  const priorPayment =
    await store.getMonitoringPassPaymentByDigest(authorizationDigest);

  // Settled → issue/resolve pass; never re-challenge. Claim credential re-derived.
  if (priorPayment?.status === "settled" && priorPayment.settlement_ref) {
    return issuePassForSettlement({
      store,
      settlementRef: priorPayment.settlement_ref,
      paymentId: priorPayment.id,
      nowIso,
      payer: priorPayment.payer_address,
      env: args.env,
    });
  }

  // settlement_unknown / pending / review — resume without inviting a second payment.
  if (
    priorPayment &&
    (priorPayment.status === "verifying" ||
      priorPayment.status === "settlement_pending" ||
      priorPayment.status === "settlement_unknown" ||
      priorPayment.status === "settlement_review_required")
  ) {
    return resumePendingPassSettlement({
      store,
      payment: priorPayment,
      resource: args.resource,
      env: args.env,
      nowIso,
      fetchImpl: args.fetchImpl,
    });
  }

  // rejected/failed prior: do not auto re-challenge as if first contact —
  // still allow a deliberate new payment only after conclusive failure.
  if (
    priorPayment &&
    (priorPayment.status === "rejected" || priorPayment.status === "failed")
  ) {
    return challengeResult({
      resource: args.resource,
      env: args.env,
      rejected: true,
      sanitizedReason:
        priorPayment.sanitized_settle_reason ||
        priorPayment.sanitized_verify_reason ||
        undefined,
    });
  }

  const payment = await store.upsertMonitoringPassPayment({
    id: newId("pass_pay"),
    authorizationDigest,
    nowIso,
    status: "authorization_received",
  });

  await store.updateMonitoringPassPayment({
    id: payment.id,
    status: "verifying",
    settlementRef: null,
    nowIso,
    lastProviderOperation: "verify",
    incrementAttempt: true,
  });

  let settlementRef: string | null = null;
  let pendingTxHash: string | null = null;
  let unknownTxHash: string | null = null;
  let payer: string | undefined;
  let isUnknown = false;
  let isReviewRequired = false;
  let providerPaymentId: string | null = null;
  let providerAuthorizationId: string | null = null;
  let canonicalRequirements: CanonicalPaymentRequirements | undefined;

  // One canonical requirements object for challenge-equivalent verify/settle.
  const { requirements: challengeReqs } =
    await buildMonitoringPassChallengeAsync({
      resource: args.resource,
      env: args.env,
    });
  canonicalRequirements = challengeReqs;

  if (args.testVerifier) {
    const verifier = resolveX402Verifier({
      env: args.env,
      testVerifier: args.testVerifier,
    });
    const verified = await verifier.verifyPayment({
      resource: args.resource,
      authorizationHeader: args.paymentAuthorizationHeader,
      requirements: canonicalRequirements,
    });
    if (!verified.ok) {
      if (verified.reason === "settlement_pending" && verified.pendingTxHash) {
        pendingTxHash = verified.pendingTxHash;
        payer = verified.payer;
      } else if (
        verified.reason === "settlement_review_required" ||
        (verified.reason === "settlement_unknown" && !verified.pendingTxHash)
      ) {
        isReviewRequired = true;
        payer = verified.payer;
        await store.updateMonitoringPassPayment({
          id: payment.id,
          status: "settlement_review_required",
          settlementRef: null,
          nowIso,
          payerAddress: payer ?? null,
          sanitizedSettleReason: verified.sanitizedReason,
          lastProviderOperation: "settle",
        });
      } else if (verified.reason === "settlement_unknown") {
        unknownTxHash = verified.pendingTxHash ?? null;
        isUnknown = true;
        payer = verified.payer;
        await store.updateMonitoringPassPayment({
          id: payment.id,
          status: "settlement_unknown",
          settlementRef: unknownTxHash,
          nowIso,
          payerAddress: payer ?? null,
          sanitizedSettleReason: verified.sanitizedReason,
          lastProviderOperation: "settle",
        });
      } else {
        const status: MonitoringPassPaymentStatus =
          verified.reason === "rejected" ||
          verified.reason === "invalid_signature" ||
          verified.reason === "amount_mismatch" ||
          verified.reason === "resource_mismatch"
            ? "rejected"
            : "failed";
        await store.updateMonitoringPassPayment({
          id: payment.id,
          status,
          settlementRef: null,
          nowIso,
          sanitizedVerifyReason: verified.sanitizedReason,
          lastProviderOperation: "verify",
        });
        return challengeResult({
          resource: args.resource,
          env: args.env,
          rejected: status === "rejected",
          sanitizedReason: verified.sanitizedReason,
        });
      }
    } else {
      settlementRef = verified.settlementRef;
      payer = verified.payer;
    }
  } else if (isOkxSellerConfigured(args.env ?? process.env)) {
    const seller = createOkxSellerVerifier({ env: args.env });
    const detailed: OkxSellerVerifyOutcome =
      await seller.verifyAndSettleDetailed({
        resource: args.resource,
        authorizationHeader: args.paymentAuthorizationHeader,
        requirements: canonicalRequirements,
      });
    providerPaymentId = detailed.providerPaymentId ?? null;
    providerAuthorizationId = detailed.providerAuthorizationId ?? null;
    if (detailed.ok) {
      settlementRef = detailed.settlementRef;
      payer = detailed.payer;
    } else if (
      detailed.reason === "settlement_pending" &&
      detailed.pendingTxHash
    ) {
      pendingTxHash = detailed.pendingTxHash;
      payer = detailed.payer;
    } else if (
      detailed.reason === "settlement_review_required" ||
      (detailed.reason === "settlement_unknown" && !detailed.pendingTxHash)
    ) {
      isReviewRequired = true;
      payer = detailed.payer;
      await store.updateMonitoringPassPayment({
        id: payment.id,
        status: "settlement_review_required",
        settlementRef: null,
        nowIso,
        payerAddress: payer ?? null,
        sanitizedSettleReason: detailed.sanitizedSettleReason,
        lastProviderOperation: detailed.lastProviderOperation ?? "settle",
        providerPaymentId,
        providerAuthorizationId,
      });
    } else if (detailed.reason === "settlement_unknown") {
      isUnknown = true;
      unknownTxHash = detailed.pendingTxHash ?? null;
      payer = detailed.payer;
      await store.updateMonitoringPassPayment({
        id: payment.id,
        status: "settlement_unknown",
        settlementRef: unknownTxHash,
        nowIso,
        payerAddress: payer ?? null,
        sanitizedSettleReason: detailed.sanitizedSettleReason,
        lastProviderOperation: detailed.lastProviderOperation ?? "settle",
        providerPaymentId,
        providerAuthorizationId,
      });
    } else {
      const status: MonitoringPassPaymentStatus =
        detailed.reason === "invalid_signature" ||
        detailed.reason === "amount_mismatch" ||
        detailed.reason === "resource_mismatch" ||
        detailed.reason === "rejected"
          ? "rejected"
          : "failed";
      await store.updateMonitoringPassPayment({
        id: payment.id,
        status,
        settlementRef: null,
        nowIso,
        payerAddress: detailed.payer ?? null,
        sanitizedVerifyReason: detailed.sanitizedVerifyReason,
        sanitizedSettleReason: detailed.sanitizedSettleReason,
        lastProviderOperation: detailed.lastProviderOperation,
        providerPaymentId,
        providerAuthorizationId,
      });
      return challengeResult({
        resource: args.resource,
        env: args.env,
        rejected: status === "rejected",
        sanitizedReason:
          detailed.sanitizedSettleReason || detailed.sanitizedVerifyReason,
      });
    }
  } else {
    await store.updateMonitoringPassPayment({
      id: payment.id,
      status: "failed",
      settlementRef: null,
      nowIso,
      lastProviderOperation: "not_configured",
    });
    return challengeResult({ resource: args.resource, env: args.env });
  }

  if (isReviewRequired) {
    const cont = await ensureContinuation(
      store,
      payment.id,
      nowIso,
      null,
      args.env,
    );
    return {
      ok: true,
      status: "SETTLEMENT_REVIEW_REQUIRED",
      http_status: 200,
      pass_continuation_id: cont.id,
      operator_reference: payment.id,
      note: "Settlement outcome cannot be confirmed automatically (no queryable transaction). Payment is locked. Do not pay again. Operator review required with verified transaction evidence.",
    };
  }

  if (isUnknown) {
    const cont = await ensureContinuation(
      store,
      payment.id,
      nowIso,
      null,
      args.env,
    );
    return {
      ok: true,
      status: "PAYMENT_SETTLEMENT_UNKNOWN",
      http_status: 200,
      pass_continuation_id: cont.id,
      note: unknownTxHash
        ? "Settlement submitted but confirmation is temporarily unavailable. Do not pay again. Nobu will reconcile from the durable payment record using the stored transaction reference."
        : "Settlement outcome is temporarily unknown. Do not pay again.",
      payment_response_header: unknownTxHash
        ? safeReceipt({
            success: false,
            transaction: unknownTxHash,
            payer,
            status: "pending",
          })
        : undefined,
    };
  }

  if (pendingTxHash) {
    await store.updateMonitoringPassPayment({
      id: payment.id,
      status: "settlement_pending",
      settlementRef: pendingTxHash,
      nowIso,
      payerAddress: payer ?? null,
      lastProviderOperation: "settle",
      providerPaymentId,
      providerAuthorizationId,
    });
    const polled = await pollPendingSettlementToPass({
      store,
      paymentId: payment.id,
      env: args.env,
      nowIso,
      payer,
    });
    if (polled) return polled;

    const cont = await ensureContinuation(
      store,
      payment.id,
      nowIso,
      null,
      args.env,
    );
    return {
      ok: true,
      status: "PAYMENT_SETTLEMENT_PENDING",
      http_status: 200,
      pass_continuation_id: cont.id,
      note: "Settlement submitted; awaiting on-chain confirmation. No pass is issued until it confirms. Do not pay again — use free RESOLVE_MONITORING_PASS with the same pass_continuation_id.",
      payment_response_header: safeReceipt({
        success: true,
        transaction: pendingTxHash,
        payer,
        status: "pending",
      }),
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
    payerAddress: payer ?? null,
    lastProviderOperation: "settle",
    providerPaymentId,
    providerAuthorizationId,
  });

  return issuePassForSettlement({
    store,
    settlementRef,
    paymentId: payment.id,
    nowIso,
    payer,
    env: args.env,
  });
}

async function resumePendingPassSettlement(args: {
  store: AuthStore;
  payment: MonitoringPassPaymentRow;
  resource: string;
  env?: EnvRecord;
  nowIso: string;
  fetchImpl?: OkxHttpFetch;
}): Promise<MonitoringPassResult> {
  // settlement_unknown: keep unknown unless settle/status conclusively confirms.
  // Never re-challenge and never invite another payment.
  if (args.payment.status === "settlement_unknown") {
    if (!args.payment.settlement_ref) {
      const cont = await ensureContinuation(
        args.store,
        args.payment.id,
        args.nowIso,
      );
      return {
        ok: true,
        status: "SETTLEMENT_REVIEW_REQUIRED",
        http_status: 200,
        pass_continuation_id: cont.id,
        operator_reference: args.payment.id,
        note: "Settlement outcome cannot be confirmed automatically (no queryable transaction). Payment is locked. Do not pay again. Operator review required.",
      };
    }
    // Have a tx hash — try confirm; if still ambiguous stay unknown.
    const outcomeUnknown = await confirmPendingPassPayment({
      store: args.store,
      payment: args.payment,
      env: args.env,
      nowIso: args.nowIso,
      fetchImpl: args.fetchImpl,
    });
    if (outcomeUnknown.kind === "issued") {
      return finalizeIssuedPassResult({
        store: args.store,
        pass: outcomeUnknown.pass,
        paymentId: args.payment.id,
        settlementRef: outcomeUnknown.pass.settlement_ref,
        nowIso: args.nowIso,
        payer: outcomeUnknown.pass.payer_address,
        env: args.env,
      });
    }
    if (outcomeUnknown.kind === "failed") {
      return challengeResult({
        resource: args.resource,
        env: args.env,
        rejected: true,
      });
    }
    const cont = await ensureContinuation(
      args.store,
      args.payment.id,
      args.nowIso,
    );
    return {
      ok: true,
      status: "PAYMENT_SETTLEMENT_UNKNOWN",
      http_status: 200,
      pass_continuation_id: cont.id,
      note: "Settlement outcome is still unknown. Do not pay again.",
      payment_response_header: args.payment.settlement_ref
        ? safeReceipt({
            success: true,
            transaction: args.payment.settlement_ref,
            status: "pending",
          })
        : undefined,
    };
  }

  const outcome = await confirmPendingPassPayment({
    store: args.store,
    payment: args.payment,
    env: args.env,
    nowIso: args.nowIso,
    fetchImpl: args.fetchImpl,
  });

  if (outcome.kind === "issued") {
    return finalizeIssuedPassResult({
      store: args.store,
      pass: outcome.pass,
      paymentId: args.payment.id,
      settlementRef: outcome.pass.settlement_ref,
      nowIso: args.nowIso,
      payer: outcome.pass.payer_address,
      env: args.env,
    });
  }
  if (outcome.kind === "failed") {
    // Conclusive on-chain failure may re-challenge.
    return challengeResult({
      resource: args.resource,
      env: args.env,
      rejected: true,
    });
  }

  const cont = await ensureContinuation(
    args.store,
    args.payment.id,
    args.nowIso,
  );
  const isUnknown =
    args.payment.status === "settlement_unknown" ||
    outcome.note?.includes("unknown");
  return {
    ok: true,
    status: isUnknown
      ? "PAYMENT_SETTLEMENT_UNKNOWN"
      : "PAYMENT_SETTLEMENT_PENDING",
    http_status: 200,
    pass_continuation_id: cont.id,
    note: outcome.note,
    payment_response_header: args.payment.settlement_ref
      ? safeReceipt({
          success: true,
          transaction: args.payment.settlement_ref,
          status: "pending",
        })
      : undefined,
  };
}

async function pollPendingSettlementToPass(args: {
  store: AuthStore;
  paymentId: string;
  env?: EnvRecord;
  nowIso: string;
  fetchImpl?: OkxHttpFetch;
  delaysMs?: readonly number[];
  payer?: string;
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
      return finalizeIssuedPassResult({
        store: args.store,
        pass: outcome.pass,
        paymentId: args.paymentId,
        settlementRef: outcome.pass.settlement_ref,
        nowIso: args.nowIso,
        payer: args.payer,
        env: args.env,
      });
    }
    if (outcome.kind === "failed") return null;
  }
  return null;
}

export async function confirmPaymentById(args: {
  paymentId: string;
  now?: Date;
  sqliteDb?: NobuDatabase;
  env?: EnvRecord;
  fetchImpl?: OkxHttpFetch;
}): Promise<{
  kind: "issued" | "pending" | "failed" | "not_found" | "unknown";
  pass?: MonitoringPassRow;
  note?: string;
}> {
  const nowIso = (args.now ?? new Date()).toISOString();
  const store = await resolveStore(args.sqliteDb, args.env);
  const payment = await store.getMonitoringPassPaymentById(args.paymentId);
  if (!payment) return { kind: "not_found" };
  if (payment.status === "settlement_unknown" && !payment.settlement_ref) {
    {

      const _c = await ensureContinuation(store, payment.id, nowIso);

      void _c;

    }
    return { kind: "unknown", note: "Settlement outcome unknown." };
  }
  const outcome = await confirmPendingPassPayment({
    store,
    payment,
    env: args.env,
    nowIso,
    fetchImpl: args.fetchImpl,
  });
  if (outcome.kind === "issued") {
    {

      const _c = await ensureContinuation(store, payment.id, nowIso, outcome.pass.id);

      void _c;

    }
    return { kind: "issued", pass: outcome.pass };
  }
  if (outcome.kind === "failed") return { kind: "failed" };
  {

    const _c = await ensureContinuation(store, payment.id, nowIso);

    void _c;

  }
  return { kind: "pending", note: outcome.note };
}

type ConfirmPendingOutcome =
  | { kind: "issued"; pass: MonitoringPassRow }
  | { kind: "pending"; note: string }
  | { kind: "failed" };

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
      note: "Settlement status unavailable; still not payment complete. Do not pay again.",
    };
  }

  if (status.status === "pending" || (!status.success && !status.status)) {
    return {
      kind: "pending",
      note: "Settlement still pending confirmation.",
    };
  }
  const reconIds = extractProviderIds(
    status as unknown as Record<string, unknown>,
  );

  if (status.status === "failed" || status.success === false) {
    await args.store.updateMonitoringPassPayment({
      id: args.payment.id,
      status: "failed",
      settlementRef: null,
      nowIso: args.nowIso,
      sanitizedSettleReason: status.errorReason || status.errorMessage,
      lastProviderOperation: "settle_status",
      providerPaymentId: reconIds.providerPaymentId,
      providerAuthorizationId: reconIds.providerAuthorizationId,
    });
    return { kind: "failed" };
  }

  const settlementRef = String(status.transaction || pendingTxHash).trim();
  await args.store.updateMonitoringPassPayment({
    id: args.payment.id,
    status: "settled",
    settlementRef,
    nowIso: args.nowIso,
    payerAddress: status.payer ?? null,
    lastProviderOperation: "settle_status",
    providerPaymentId: reconIds.providerPaymentId,
    providerAuthorizationId: reconIds.providerAuthorizationId,
  });
  const issued = await issuePassForSettlement({
    store: args.store,
    settlementRef,
    paymentId: args.payment.id,
    nowIso: args.nowIso,
    payer: status.payer,
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
  issued_pass_ids: string[];
  continuations_backfilled: number;
  journeys_backfilled: number;
};

export async function reconcilePendingPassSettlements(args: {
  now?: Date;
  sqliteDb?: NobuDatabase;
  env?: EnvRecord;
  limit?: number;
  fetchImpl?: OkxHttpFetch;
} = {}): Promise<PassSettlementReconciliationResult> {
  const now = args.now ?? new Date();
  const nowIso = now.toISOString();
  const store = await resolveStore(args.sqliteDb, args.env);

  const verifying = await store.listVerifyingMonitoringPassPayments();
  const settledOrphan =
    await store.listSettledMonitoringPassPaymentsWithoutPass();

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
    if (payment.status === "settlement_unknown" && !payment.settlement_ref) {
      stillPending += 1;
      {

        const _c = await ensureContinuation(store, payment.id, nowIso);

        void _c;

      }
      continue;
    }
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
      {

        const _c = await ensureContinuation(store, payment.id, nowIso, outcome.pass.id);

        void _c;

      }
    } else if (outcome.kind === "failed") {
      failed += 1;
    } else {
      stillPending += 1;
      if (payment.settlement_ref) {
        {

          const _c = await ensureContinuation(store, payment.id, nowIso);

          void _c;

        }
      }
    }
  }

  let continuationsBackfilled = 0;
  let journeysBackfilled = 0;

  // Historical: settled + pass + no continuation row.
  const missingContinuations =
    await store.listSettledPassPaymentsMissingContinuation();
  for (const payment of missingContinuations) {
    const pass = await store.getMonitoringPassByPaymentId(payment.id);
    if (!pass) continue;
    const beforeCont = await store.getMonitoringPassContinuationByPaymentId(
      payment.id,
    );
    const cont = await ensureContinuation(
      store,
      payment.id,
      nowIso,
      pass.id,
      args.env,
    );
    if (!beforeCont) continuationsBackfilled += 1;
    const beforeJourney = await store.getMarketplacePurchaseJourneyByPassId(
      pass.id,
    );
    const journey = await ensureIssuedPassJourney(store, {
      monitoringPassId: pass.id,
      passContinuationId: cont.id,
      nowIso,
      env: args.env,
    });
    if (!beforeJourney && journey) journeysBackfilled += 1;
  }

  // Authoritative delivery-pending recovery: settled + pass (issued/redeemed)
  // + no marketplace journey — independent of pending/orphan/continuation batches.
  // Continuations may already exist; do not require them to be missing.
  const missingJourneys =
    await store.listSettledMonitoringPassPaymentsMissingJourney(args.limit);
  for (const payment of missingJourneys) {
    const pass = await store.getMonitoringPassByPaymentId(payment.id);
    if (!pass) continue;
    if (pass.status !== "issued" && pass.status !== "redeemed") continue;

    const beforeJourney = await store.getMarketplacePurchaseJourneyByPassId(
      pass.id,
    );
    // Never modify an existing advanced (or any) journey — skip if present.
    if (beforeJourney) continue;

    // Resolve continuation; create only when genuinely absent.
    let contRow =
      (await store.getMonitoringPassContinuationByPassId(pass.id)) ??
      (await store.getMonitoringPassContinuationByPaymentId(payment.id));
    if (!contRow) {
      const cont = await ensureContinuation(
        store,
        payment.id,
        nowIso,
        pass.id,
        args.env,
      );
      continuationsBackfilled += 1;
      contRow = await store.getMonitoringPassContinuationById(cont.id);
      if (!contRow) continue;
    }

    const journey = await ensureIssuedPassJourney(store, {
      monitoringPassId: pass.id,
      passContinuationId: contRow.id,
      nowIso,
      env: args.env,
    });
    // ensureMarketplacePurchaseJourney is ON CONFLICT DO NOTHING and never
    // resets stage — only count a newly readable journey after previous miss.
    if (journey) journeysBackfilled += 1;
  }

  // Journeys for passes newly issued in this reconcile batch (hot path).
  for (const passId of issuedPassIds) {
    const existingJourney =
      await store.getMarketplacePurchaseJourneyByPassId(passId);
    if (existingJourney) continue;
    let contRow = await store.getMonitoringPassContinuationByPassId(passId);
    if (!contRow) {
      const pass = await store.getMonitoringPassById(passId);
      if (!pass?.payment_id) continue;
      const cont = await ensureContinuation(
        store,
        pass.payment_id,
        nowIso,
        passId,
        args.env,
      );
      contRow = await store.getMonitoringPassContinuationById(cont.id);
      if (!contRow) continue;
    }
    const journey = await ensureIssuedPassJourney(store, {
      monitoringPassId: passId,
      passContinuationId: contRow.id,
      nowIso,
      env: args.env,
    });
    if (journey) journeysBackfilled += 1;
  }

  return {
    scanned: limited.length,
    issued,
    still_pending: stillPending,
    failed,
    issued_pass_ids: issuedPassIds,
    continuations_backfilled: continuationsBackfilled,
    journeys_backfilled: journeysBackfilled,
  };
}

const MARKETPLACE_STAGES = new Set<string>([
  "confirm_use_pass",
  "purchase_description",
  "product_discovery",
  "candidate_id",
  "email",
  "verification_code",
  "consents",
]);

/**
 * Build public paid success body from an already-ensured journey stage.
 * Never includes pass_claim_credential / claim_credential.
 * Replay never resets an advanced journey; complete → MONITORING_ACTIVE.
 */
function issuedPassPublicBody(
  result: Extract<MonitoringPassResult, { status: "MONITORING_PASS_ISSUED" }>,
  env?: EnvRecord,
): Record<string, unknown> {
  const freeEndpoint = resolveFreeServiceEndpoint(env);
  const baseMeta = {
    service_id: PAID_SERVICE_ID,
    service_name: PAID_SERVICE_NAME,
    deliverable: { type: "monitoring_pass", quantity: 1 },
    monitoring_pass_id: result.pass.id,
    pass_continuation_id: result.pass_continuation_id,
    journey_id: result.journey_id,
    price_amount: result.pass.price_amount,
    price_currency: result.pass.price_currency,
    redeemable_for: monitoringPassRedeemableFor(env),
    payment_status: "recognized" as const,
    second_payment_required: false,
    next_service_id: FREE_SERVICE_ID,
    next_service_endpoint: freeEndpoint,
    free_service_endpoint: freeEndpoint,
    protocol_replay: null,
    transaction_receipt: {
      network: DEFAULT_SETTLEMENT_NETWORK,
      settlement_confirmed: true,
    },
  };

  if (result.journey_stage === "complete") {
    const active = marketplaceMonitoringActiveContract({
      journeyId: result.journey_id,
      monitoringPassId: result.pass.id,
      passContinuationId: result.pass_continuation_id,
    });
    return {
      ...active,
      ...baseMeta,
      status: "MONITORING_ACTIVE",
      current_step: "complete",
      monitoring_active: true,
      journey_complete: true,
      input_required: false,
      automatic_continue: false,
      required_fields: [],
      fields: [],
      requiredArgs: [],
      required_user_input: null,
      protocol_continuation: null,
      machine_continuation: null,
      interaction: buildAutomaticInteraction(),
    };
  }

  const stage = (
    MARKETPLACE_STAGES.has(result.journey_stage)
      ? result.journey_stage
      : "confirm_use_pass"
  ) as MarketplaceStage;

  // For advanced human stages, return the durable stage contract without secrets.
  // Paid first handoff and confirm_use_pass share the same confirm-only shape.
  const stageContract = marketplaceIncompleteContract({
    stage,
    journeyId: result.journey_id,
    monitoringPassId: result.pass.id,
    passContinuationId: result.pass_continuation_id,
    env,
  });

  // Prefer paid-spec handoff for confirm_use_pass (explicit confirm field).
  if (stage === "confirm_use_pass") {
    const protocol_continuation = buildPaidJourneyHandoffContinuation({
      journeyId: result.journey_id,
      env,
    });
    return {
      status: "MONITORING_PASS_ISSUED",
      current_step: "confirm_use_pass",
      completed_step: "MONITORING_PASS_ISSUED",
      next_action: "CONFIRM_USE_PASS",
      message: stageContract.message,
      ...baseMeta,
      monitoring_active: false,
      journey_complete: false,
      automatic_continue: false,
      input_required: true,
      required_fields: ["confirm_use_pass"],
      fields: ["confirm_use_pass"],
      requiredArgs: ["confirm_use_pass"],
      required_user_input: {
        required_fields: ["confirm_use_pass"],
        description: stageContract.message,
      },
      protocol_continuation,
      machine_continuation: protocol_continuation,
      interaction: buildUserInputInteraction(["confirm_use_pass"]),
    };
  }

  return {
    ...stageContract,
    ...baseMeta,
    monitoring_active: false,
    journey_complete: false,
  };
}

/**
 * Neutral typed unpaid/paid body — facts only, no imperative agent-control prose.
 * Successful issuance returns the durable journey stage (no claim secret).
 */
export function monitoringPassResponseBody(
  result: MonitoringPassResult,
  env?: EnvRecord,
): Record<string, unknown> {
  if (result.ok && result.status === "MONITORING_PASS_ISSUED") {
    return issuedPassPublicBody(result, env);
  }

  if (result.ok && result.status === "MONITORING_PASS_DELIVERY_PENDING") {
    const freeEndpoint = resolveFreeServiceEndpoint(env);
    return {
      status: "MONITORING_PASS_DELIVERY_PENDING",
      service_id: PAID_SERVICE_ID,
      service_name: PAID_SERVICE_NAME,
      deliverable: { type: "monitoring_pass", quantity: 1 },
      monitoring_pass_id: result.pass.id,
      pass_continuation_id: result.pass_continuation_id,
      price_amount: result.pass.price_amount,
      price_currency: result.pass.price_currency,
      redeemable_for: monitoringPassRedeemableFor(env),
      monitoring_active: false,
      payment_status: "recognized",
      second_payment_required: false,
      journey_complete: false,
      automatic_continue: false,
      input_required: false,
      required_fields: [],
      fields: [],
      requiredArgs: [],
      required_user_input: null,
      protocol_continuation: null,
      machine_continuation: null,
      interaction: buildAutomaticInteraction(),
      next_service_id: FREE_SERVICE_ID,
      next_service_endpoint: freeEndpoint,
      free_service_endpoint: freeEndpoint,
      note: result.note,
      message: result.note,
      protocol_replay: null,
      transaction_receipt: {
        network: DEFAULT_SETTLEMENT_NETWORK,
        settlement_confirmed: true,
      },
    };
  }

  if (result.ok) {
    return {
      status: result.status,
      service_id: PAID_SERVICE_ID,
      service_name: PAID_SERVICE_NAME,
      deliverable: { type: "monitoring_pass", quantity: 1 },
      pass_continuation_id: result.pass_continuation_id,
      monitoring_active: false,
      payment_status:
        result.status === "SETTLEMENT_REVIEW_REQUIRED"
          ? "review_required"
          : result.status === "PAYMENT_SETTLEMENT_UNKNOWN"
            ? "unknown"
            : "pending",
      second_payment_required: false,
      next_service_id: FREE_SERVICE_ID,
      note: "note" in result ? result.note : undefined,
      journey_complete: false,
      ...("operator_reference" in result && result.operator_reference
        ? { operator_reference: result.operator_reference }
        : {}),
    };
  }

  // Unpaid / rejected first contact — neutral facts only.
  const machine = buildPaidPrePaymentMachineFields();
  const accept = result.challenge.accepts[0];
  return {
    status: result.status,
    service_id: PAID_SERVICE_ID,
    service_name: PAID_SERVICE_NAME,
    deliverable: machine.deliverable,
    business_input_required: false,
    required_fields: [],
    fields: [],
    requiredArgs: [],
    amount: accept?.amount ?? MONITORING_PRICE_ATOMIC_UNITS,
    token: accept?.asset,
    network: accept?.network,
    scheme: accept?.scheme,
    replay_header_name: X402_PAYMENT_HEADER_NAME,
    monitoring_active: false,
    payment_status: "required",
    next_service_id_after_issuance: FREE_SERVICE_ID,
    next_service_id: FREE_SERVICE_ID,
    next_action_after_payment: "CONTINUE_PURCHASE_SETUP",
    x402Version: result.challenge.x402Version,
    resource: result.challenge.resource,
    accepts: result.challenge.accepts,
    selected_service_id: PAID_SERVICE_ID,
    selected_service_name: PAID_SERVICE_NAME,
    product_details_required_before_payment: false,
    email_required_before_payment: false,
    alert_threshold_required: false,
    wallet_address_required_as_service_input: false,
    journey_complete: false,
    second_payment_required: false,
    ...(result.status === "PAYMENT_REJECTED" && result.sanitized_reason
      ? { sanitized_reason: result.sanitized_reason }
      : {}),
  };
}

/**
 * Free-service resolution of a Monitoring Pass by continuation id or public
 * pass id. Public ids alone never authorize claiming a journey.
 */
export async function resolveMonitoringPassForAgent(args: {
  passContinuationId?: string | null;
  monitoringPassId?: string | null;
  passClaimCredential?: string | null;
  now?: Date;
  sqliteDb?: NobuDatabase;
  env?: EnvRecord;
  fetchImpl?: OkxHttpFetch;
}): Promise<{
  http_status: number;
  body: Record<string, unknown>;
}> {
  const nowIso = (args.now ?? new Date()).toISOString();
  const contId = String(args.passContinuationId || "").trim();
  const passId = String(args.monitoringPassId || "").trim();
  const claimCred = String(args.passClaimCredential || "").trim();
  const genericMissing = {
    status: "MONITORING_PASS_NOT_FOUND",
    monitoring_active: false,
    payment_status: "not_required",
    second_payment_required: false,
    next_service_id: FREE_SERVICE_ID,
    message:
      "No Monitoring Pass was found for that reference. Do not invent a payment.",
  };

  if (!contId && !passId) {
    return {
      http_status: 400,
      body: {
        status: "INTERNAL_CONTINUATION_STATE_MISSING",
        error: "invalid_input",
        message:
          "Continuation state is unavailable. Do not ask the user for internal identifiers or credentials. Do not invent a payment.",
        guidance:
          "Do not request payment or internal credentials from the user. Retry only with the machine continuation from a successful paid response, if still held.",
        monitoring_active: false,
        second_payment_required: false,
        input_required: false,
        required_fields: [],
        fields: [],
        requiredArgs: [],
        required_user_input: null,
        retry_safe: false,
        next_action: "CONTACT_SUPPORT_WITH_JOURNEY_ID",
      },
    };
  }

  const store = await resolveStore(args.sqliteDb, args.env);
  // Prefer continuation id when both are supplied (paid response includes both).
  let continuation = contId
    ? await store.getMonitoringPassContinuationById(contId)
    : await store.getMonitoringPassContinuationByPassId(passId);
  if (continuation && contId && passId && continuation.monitoring_pass_id) {
    if (continuation.monitoring_pass_id !== passId) {
      return {
        http_status: 400,
        body: {
          status: "INTERNAL_CONTINUATION_STATE_MISSING",
          error: "invalid_input",
          message:
            "Continuation state is unavailable or inconsistent. Do not ask the user for internal identifiers. Do not invent a payment.",
          guidance:
            "Do not request payment or internal credentials from the user.",
          monitoring_active: false,
          second_payment_required: false,
          input_required: false,
          required_fields: [],
          fields: [],
          requiredArgs: [],
          required_user_input: null,
          retry_safe: false,
          next_action: "CONTACT_SUPPORT_WITH_JOURNEY_ID",
        },
      };
    }
  }

  if (!continuation && passId) {
    // Public pass ids alone cannot mint a secure continuation/claim.
    return {
      http_status: 404,
      body: {
        status: "INTERNAL_CONTINUATION_STATE_MISSING",
        message:
          "This pass cannot be continued from a public identifier alone. Do not ask the user for internal credentials. Historical passes need operator recovery. Do not invent a payment.",
        guidance:
          "Do not request payment or internal credentials from the user.",
        monitoring_active: false,
        second_payment_required: false,
        input_required: false,
        required_fields: [],
        fields: [],
        requiredArgs: [],
        required_user_input: null,
        retry_safe: false,
        next_action: "CONTACT_SUPPORT_WITH_JOURNEY_ID",
      },
    };
  }

  if (!continuation) {
    return {
      http_status: 404,
      body: {
        ...genericMissing,
        status: "INTERNAL_CONTINUATION_STATE_MISSING",
        message:
          "No Monitoring Pass was found for that reference. Do not invent a payment. Do not ask the user for internal credentials.",
        guidance:
          "Do not request payment or internal credentials from the user.",
        input_required: false,
        required_fields: [],
        fields: [],
        requiredArgs: [],
        required_user_input: null,
        retry_safe: false,
        next_action: "CONTACT_SUPPORT_WITH_JOURNEY_ID",
      },
    };
  }

  // Read-only claim status — never consume here. Only claimPassAndCreateJourney consumes.
  const claimRequired = Boolean(
    continuation.claim_credential_hash &&
      !continuation.claim_credential_consumed_at,
  );
  void claimCred; // resolve does not validate or consume credentials

  if (continuation.status === "issued" && continuation.monitoring_pass_id) {
    const pass = await store.getMonitoringPassById(
      continuation.monitoring_pass_id,
    );
    if (pass && (pass.status === "issued" || pass.status === "redeemed")) {
      return {
        http_status: 200,
        body: {
          status: "MONITORING_PASS_ISSUED",
          monitoring_pass_id: pass.id,
          pass_continuation_id: continuation.id,
          pass_status: pass.status,
          payment_status: "recognized",
          second_payment_required: false,
          monitoring_active: false,
          next_service_id: FREE_SERVICE_ID,
          claim_required: claimRequired,
          // Resolve never authorizes claim; journey creation must call claimPassAndCreateJourney.
          claim_authorized: false,
        },
      };
    }
  }

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
      {

        const _c = await ensureContinuation(
        store,
        payment.id,
        nowIso,
        outcome.pass.id,
      );

        void _c;

      }
      return resolveMonitoringPassForAgent({
        passContinuationId: continuation.id,
        passClaimCredential: args.passClaimCredential,
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
      status: "PAYMENT_SETTLEMENT_PENDING",
      pass_continuation_id: continuation.id,
      payment_status: "pending",
      second_payment_required: false,
      monitoring_active: false,
      next_service_id: FREE_SERVICE_ID,
      message:
        "Settlement is still confirming. Your Monitoring Pass is not ready yet. Do not pay again.",
    },
  };
}
