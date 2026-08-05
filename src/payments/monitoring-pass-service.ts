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
import { buildPaidPassContinuation } from "../a2mcp/protocol-continuation.js";
import { derivePassClaimCredential } from "./claim-credential.js";
import type { CanonicalPaymentRequirements } from "./canonical-requirements.js";

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
      /** Single-use claim secret — only on first successful issue response. */
      pass_claim_credential?: string;
      settlementRef: string;
      payer?: string;
      payment_response_header: string;
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

export type EnsureContinuationResult =
  | {
      ok: true;
      id: string;
      claimCredentialRaw?: string;
    }
  | {
      ok: false;
      reason: "PASS_HANDOFF_CONFIGURATION_REQUIRED";
    };

/**
 * Concurrency-safe continuation + claim credential:
 * 1) insert/resolve unique continuation first;
 * 2) read winning row id;
 * 3) derive credential from winning payment_id + continuation_id;
 * 4) store hash when absent;
 * 5) reread and verify stored hash;
 * 6) return credential derived from the actual stored row.
 *
 * Fails closed when NOBU_PASS_CLAIM_SECRET is not configured.
 */
async function ensureContinuation(
  store: AuthStore,
  paymentId: string,
  nowIso: string,
  monitoringPassId?: string | null,
  env?: EnvRecord,
): Promise<EnsureContinuationResult> {
  // Step 1–2: insert or resolve unique continuation without inventing a claim yet.
  const provisionalId = newContinuationId();
  let row = await store.ensureMonitoringPassContinuation({
    id: provisionalId,
    paymentId,
    monitoringPassId: monitoringPassId ?? null,
    status: monitoringPassId ? "issued" : "pending",
    claimCredentialHash: null,
    nowIso,
  });

  // Winning id may differ under concurrency (ON CONFLICT payment_id).
  const winningId = row.id;

  // Step 3: derive from the actual winning row identity.
  const derived = derivePassClaimCredential({
    paymentId,
    continuationId: winningId,
    env,
  });
  if (!derived) {
    return { ok: false, reason: "PASS_HANDOFF_CONFIGURATION_REQUIRED" };
  }

  // Step 4: atomically store hash when still absent (first writer wins).
  await store.ensureMonitoringPassContinuation({
    id: winningId,
    paymentId,
    monitoringPassId: monitoringPassId ?? null,
    status: monitoringPassId ? "issued" : row.status === "claimed" ? "claimed" : "issued",
    claimCredentialHash: derived.hash,
    nowIso,
  });

  // Step 5: reread and verify stored hash matches our derivation of winning id.
  row = (await store.getMonitoringPassContinuationByPaymentId(paymentId))!;
  if (!row.claim_credential_hash) {
    return { ok: false, reason: "PASS_HANDOFF_CONFIGURATION_REQUIRED" };
  }
  // Re-derive from stored winning id — must match hash.
  const verified = derivePassClaimCredential({
    paymentId,
    continuationId: row.id,
    env,
  });
  if (!verified || verified.hash !== row.claim_credential_hash) {
    // Another writer's hash won — re-derive for their id (same payment, same row).
    const forStored = derivePassClaimCredential({
      paymentId,
      continuationId: row.id,
      env,
    });
    if (!forStored || forStored.hash !== row.claim_credential_hash) {
      return { ok: false, reason: "PASS_HANDOFF_CONFIGURATION_REQUIRED" };
    }
    return {
      ok: true,
      id: row.id,
      claimCredentialRaw: row.claim_credential_consumed_at
        ? undefined
        : forStored.raw,
    };
  }

  // Step 6: return credential only while unconsumed.
  return {
    ok: true,
    id: row.id,
    claimCredentialRaw: row.claim_credential_consumed_at
      ? undefined
      : verified.raw,
  };
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

function handoffConfigFail(
  paymentId: string,
): Extract<MonitoringPassResult, { ok: true }> {
  return {
    ok: true,
    status: "SETTLEMENT_REVIEW_REQUIRED",
    http_status: 200,
    pass_continuation_id: "",
    operator_reference: paymentId,
    note: "PASS_HANDOFF_CONFIGURATION_REQUIRED: NOBU_PASS_CLAIM_SECRET is not configured. Pass issuance cannot complete a secure handoff. Do not pay again.",
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
    const cont = await ensureContinuation(
      args.store,
      args.paymentId,
      args.nowIso,
      existing.id,
      args.env,
    );
    if (!cont.ok) return handoffConfigFail(args.paymentId);
    return {
      ok: true,
      status: "MONITORING_PASS_ISSUED",
      http_status: 200,
      pass: existing,
      pass_continuation_id: cont.id,
      pass_claim_credential: cont.claimCredentialRaw,
      settlementRef: args.settlementRef,
      payer: args.payer ?? existing.payer_address ?? undefined,
      payment_response_header: safeReceipt({
        success: true,
        transaction: args.settlementRef,
        payer: args.payer ?? undefined,
        status: "success",
      }),
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
    payerAddress: args.payer ?? null,
  });

  const cont = await ensureContinuation(
    args.store,
    args.paymentId,
    args.nowIso,
    issued.pass.id,
    args.env,
  );
  if (!cont.ok) return handoffConfigFail(args.paymentId);

  return {
    ok: true,
    status: "MONITORING_PASS_ISSUED",
    http_status: 200,
    pass: issued.pass,
    pass_continuation_id: cont.id,
    pass_claim_credential: cont.claimCredentialRaw,
    settlementRef: args.settlementRef,
    payer: args.payer ?? undefined,
    payment_response_header: safeReceipt({
      success: true,
      transaction: args.settlementRef,
      payer: args.payer ?? undefined,
      status: "success",
    }),
  };
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
    if (!cont.ok) return handoffConfigFail(payment.id);
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
    if (!cont.ok) return handoffConfigFail(payment.id);
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
    if (!cont.ok) return handoffConfigFail(payment.id);
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
      if (!cont.ok) return handoffConfigFail(args.payment.id);
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
      const cont = await ensureContinuation(
        args.store,
        args.payment.id,
        args.nowIso,
        outcomeUnknown.pass.id,
      );
      if (!cont.ok) return handoffConfigFail(args.payment.id);
      return {
        ok: true,
        status: "MONITORING_PASS_ISSUED",
        http_status: 200,
        pass: outcomeUnknown.pass,
        pass_continuation_id: cont.id,
        pass_claim_credential: cont.claimCredentialRaw,
        settlementRef: outcomeUnknown.pass.settlement_ref,
        payment_response_header: safeReceipt({
          success: true,
          transaction: outcomeUnknown.pass.settlement_ref,
          status: "success",
        }),
      };
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
    if (!cont.ok) return handoffConfigFail(args.payment.id);
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
    const cont = await ensureContinuation(
      args.store,
      args.payment.id,
      args.nowIso,
      outcome.pass.id,
    );
    if (!cont.ok) return handoffConfigFail(args.payment.id);
    return {
      ok: true,
      status: "MONITORING_PASS_ISSUED",
      http_status: 200,
      pass: outcome.pass,
      pass_continuation_id: cont.id,
      pass_claim_credential: cont.claimCredentialRaw,
      settlementRef: outcome.pass.settlement_ref,
      payer: outcome.pass.payer_address ?? undefined,
      payment_response_header: safeReceipt({
        success: true,
        transaction: outcome.pass.settlement_ref,
        status: "success",
      }),
    };
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
  if (!cont.ok) return handoffConfigFail(args.payment.id);
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
      const cont = await ensureContinuation(
        args.store,
        args.paymentId,
        args.nowIso,
        outcome.pass.id,
      );
      if (!cont.ok) return handoffConfigFail(args.paymentId);
      return {
        ok: true,
        status: "MONITORING_PASS_ISSUED",
        http_status: 200,
        pass: outcome.pass,
        pass_continuation_id: cont.id,
        pass_claim_credential: cont.claimCredentialRaw,
        settlementRef: outcome.pass.settlement_ref,
        payer: args.payer,
        payment_response_header: safeReceipt({
          success: true,
          transaction: outcome.pass.settlement_ref,
          payer: args.payer,
          status: "success",
        }),
      };
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
  const missing = await store.listSettledPassPaymentsMissingContinuation();
  for (const payment of missing) {
    const pass = await store.getMonitoringPassByPaymentId(payment.id);
    if (!pass) continue;
    {

      const _c = await ensureContinuation(store, payment.id, nowIso, pass.id);

      void _c;

    }
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
 * Neutral typed unpaid body — facts only, no imperative agent-control prose.
 * Successful issuance includes authoritative protocol_continuation so a
 * generic buyer agent can continue without asking the user for tokens.
 */
export function monitoringPassResponseBody(
  result: MonitoringPassResult,
  env?: EnvRecord,
): Record<string, unknown> {
  if (result.ok && result.status === "MONITORING_PASS_ISSUED") {
    const freeEndpoint = resolveFreeServiceEndpoint(env);
    // claim credential lives only inside protocol_continuation.body (never top-level).
    const protocol_continuation = result.pass_claim_credential
      ? buildPaidPassContinuation({
          passContinuationId: result.pass_continuation_id,
          passClaimCredential: result.pass_claim_credential,
          env,
        })
      : null;
    return {
      status: "MONITORING_PASS_ISSUED",
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
      automatic_continue: true,
      input_required: false,
      required_fields: [],
      fields: [],
      requiredArgs: [],
      required_user_input: null,
      next_service_id: FREE_SERVICE_ID,
      next_service_endpoint: freeEndpoint,
      free_service_endpoint: freeEndpoint,
      protocol_continuation,
      // Legacy mirror — identical to protocol_continuation when present.
      machine_continuation: protocol_continuation,
      protocol_replay: null,
      transaction_receipt: {
        network: DEFAULT_SETTLEMENT_NETWORK,
        // Safe public ref only — not a signature
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
      note: result.note,
      journey_complete: false,
      ...(result.operator_reference
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
        error: "invalid_input",
        status: "invalid_input",
        message:
          "Provide pass_continuation_id or monitoring_pass_id.",
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
          error: "invalid_input",
          status: "invalid_input",
          message: "pass_continuation_id and monitoring_pass_id do not match.",
        },
      };
    }
  }

  if (!continuation && passId) {
    // Public pass ids alone cannot mint a secure continuation/claim.
    return {
      http_status: 404,
      body: {
        status: "MONITORING_PASS_RECOVERY_REQUIRED",
        message:
          "This pass cannot be claimed by public id alone. Use pass_continuation_id and pass_claim_credential from the paid response. Historical passes need operator recovery.",
        monitoring_active: false,
        second_payment_required: false,
      },
    };
  }

  if (!continuation) {
    return { http_status: 404, body: genericMissing };
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
