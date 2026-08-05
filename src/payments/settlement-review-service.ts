/**
 * Evidence-based settlement review for settlement_review_required payments.
 * Binds facilitator evidence to one payment; never fabricates settlement.
 */
import { randomUUID } from "node:crypto";
import {
  getAuthStore,
  type AuthStore,
} from "../auth/auth-store.js";
import {
  DEFAULT_SETTLEMENT_ASSET,
  DEFAULT_SETTLEMENT_NETWORK,
  MONITORING_PRICE_ATOMIC_UNITS,
} from "./x402.js";
import {
  loadOkxSellerConfig,
  OkxSellerClient,
  type OkxHttpFetch,
} from "./okx-seller-client.js";
import { reconcilePendingPassSettlements } from "./monitoring-pass-service.js";
import { sha256Hex } from "../auth/crypto.js";
import { canonicalizeSettlementRef } from "./settlement-ref.js";

type EnvRecord = NodeJS.ProcessEnv | Record<string, string | undefined>;

export type SettlementReviewDecision = "settled" | "failed";

export type SettlementReviewResult =
  | {
      ok: true;
      payment_id: string;
      decision: SettlementReviewDecision;
      issued?: number;
      issued_pass_ids?: string[];
    }
  | {
      ok: false;
      error: string;
      http_status: number;
      message?: string;
      status?: string;
    };

export type SettlementStatusBody = {
  success: boolean;
  status?: string;
  transaction?: string;
  network?: string;
  payer?: string;
  amount?: string;
  payTo?: string;
  recipient?: string;
  asset?: string;
  errorReason?: string;
  /** Optional facilitator payment / authorization identifiers. */
  paymentId?: string;
  payment_id?: string;
  authorizationId?: string;
  authorization_id?: string;
};

/**
 * Independently verify a transaction via official settle/status and locked
 * commercial terms. Missing binding fields keep review (not success).
 *
 * Failed decisions additionally require at least one payment-specific binding
 * (A: stored settlement_ref, B: provider_payment_id, C: provider_authorization_id).
 * Commercial fields alone are never enough to mark a payment failed.
 */
export async function verifySettlementEvidence(args: {
  paymentId: string;
  transactionHash: string;
  env?: EnvRecord;
  fetchImpl?: OkxHttpFetch;
  expectedPayer?: string | null;
  /** Stored facilitator provider_payment_id for Binding B. */
  storedProviderPaymentId?: string | null;
  /** Stored facilitator provider_authorization_id for Binding C. */
  storedProviderAuthorizationId?: string | null;
  /** Existing settlement_ref on this payment for Binding A. */
  storedSettlementRef?: string | null;
  /**
   * "settled" — require success + full commercial fields.
   * "failed" — require conclusive failure + commercial + payment-specific binding.
   */
  mode: "settled" | "failed";
  statusOverride?: SettlementStatusBody;
}): Promise<
  | { ok: true; source: "okx_settle_status"; payer?: string; canonicalTx: string }
  | {
      ok: false;
      reason: string;
      keep_review: boolean;
      failed_conclusive?: boolean;
    }
> {
  const canonicalTx = canonicalizeSettlementRef(args.transactionHash);
  if (!canonicalTx) {
    return { ok: false, reason: "malformed_tx_hash", keep_review: true };
  }

  if (args.statusOverride) {
    return evaluateStatusBody(args.statusOverride, {
      expectedTx: canonicalTx,
      env: args.env,
      expectedPayer: args.expectedPayer,
      storedProviderPaymentId: args.storedProviderPaymentId,
      storedProviderAuthorizationId: args.storedProviderAuthorizationId,
      storedSettlementRef: args.storedSettlementRef,
      mode: args.mode,
    });
  }

  const cfg = loadOkxSellerConfig(args.env ?? process.env);
  if (!cfg) {
    return {
      ok: false,
      reason: "facilitator_not_configured",
      keep_review: true,
    };
  }
  try {
    const client = new OkxSellerClient(cfg, args.fetchImpl);
    const status = await client.getSettleStatus(canonicalTx);
    return evaluateStatusBody(status, {
      expectedTx: canonicalTx,
      env: args.env,
      expectedPayer: args.expectedPayer,
      storedProviderPaymentId: args.storedProviderPaymentId,
      storedProviderAuthorizationId: args.storedProviderAuthorizationId,
      storedSettlementRef: args.storedSettlementRef,
      mode: args.mode,
    });
  } catch {
    return {
      ok: false,
      reason: "facilitator_status_unavailable",
      keep_review: true,
    };
  }
}

/** Commercial fields: network, asset, payTo, amount when returned, payer when known. */
function evaluateCommercialFields(
  status: SettlementStatusBody,
  opts: {
    env?: EnvRecord;
    expectedPayer?: string | null;
    requireAmount: boolean;
  },
): { ok: true } | { ok: false; reason: string } {
  const network = String(status.network || "").trim();
  if (!network) {
    return { ok: false, reason: "network_missing" };
  }
  if (network !== DEFAULT_SETTLEMENT_NETWORK) {
    return { ok: false, reason: "network_mismatch" };
  }

  if (status.amount != null && String(status.amount).trim() !== "") {
    if (String(status.amount) !== MONITORING_PRICE_ATOMIC_UNITS) {
      return { ok: false, reason: "amount_mismatch" };
    }
  } else if (opts.requireAmount) {
    return { ok: false, reason: "amount_missing" };
  }

  if (status.asset == null || String(status.asset).trim() === "") {
    return { ok: false, reason: "asset_missing" };
  }
  if (
    String(status.asset).toLowerCase() !== DEFAULT_SETTLEMENT_ASSET.toLowerCase()
  ) {
    return { ok: false, reason: "asset_mismatch" };
  }

  const configuredPayTo = loadOkxSellerConfig(opts.env ?? process.env)?.payTo;
  if (!configuredPayTo) {
    return { ok: false, reason: "payto_not_configured" };
  }
  const recipient = String(status.payTo || status.recipient || "").trim();
  if (!recipient) {
    return { ok: false, reason: "recipient_missing" };
  }
  if (recipient.toLowerCase() !== configuredPayTo.toLowerCase()) {
    return { ok: false, reason: "recipient_mismatch" };
  }

  const expectedPayer = String(opts.expectedPayer || "").trim();
  const statusPayer = String(status.payer || "").trim();
  if (expectedPayer) {
    if (!statusPayer) {
      return { ok: false, reason: "payer_missing" };
    }
    if (statusPayer.toLowerCase() !== expectedPayer.toLowerCase()) {
      return { ok: false, reason: "payer_mismatch" };
    }
  }

  return { ok: true };
}

/**
 * Payment-specific bindings for failed decisions (at least one required):
 * A — canonical tx already on this payment row
 * B — stored provider_payment_id matches facilitator status
 * C — stored provider_authorization_id matches facilitator status
 *
 * Provider IDs are never compared to Nobu payment.id or authorization_digest.
 */
export function evaluatePaymentSpecificBinding(args: {
  expectedTx: string;
  storedSettlementRef?: string | null;
  storedProviderPaymentId?: string | null;
  storedProviderAuthorizationId?: string | null;
  status: SettlementStatusBody;
}): { ok: true; binding: "A" | "B" | "C" } | { ok: false; reason: string } {
  // Binding A — transaction already associated with this exact payment row.
  const storedRef = canonicalizeSettlementRef(args.storedSettlementRef ?? "");
  if (storedRef && storedRef === args.expectedTx) {
    return { ok: true, binding: "A" };
  }

  // Binding B — exact provider payment id match (opaque; not Nobu payment.id).
  const facPayId = String(
    args.status.paymentId || args.status.payment_id || "",
  ).trim();
  const storedPayId = String(args.storedProviderPaymentId || "").trim();
  if (storedPayId && facPayId) {
    if (storedPayId === facPayId) {
      return { ok: true, binding: "B" };
    }
  }

  // Binding C — exact provider authorization id match (not authorization_digest).
  const facAuthId = String(
    args.status.authorizationId || args.status.authorization_id || "",
  ).trim();
  const storedAuthId = String(args.storedProviderAuthorizationId || "").trim();
  if (storedAuthId && facAuthId) {
    if (storedAuthId === facAuthId) {
      return { ok: true, binding: "C" };
    }
  }

  // Prefer specific mismatch reasons when a pair was present and unequal.
  if (storedPayId && facPayId && storedPayId !== facPayId) {
    return { ok: false, reason: "provider_payment_id_mismatch" };
  }
  if (storedAuthId && facAuthId && storedAuthId !== facAuthId) {
    return { ok: false, reason: "provider_authorization_id_mismatch" };
  }

  return { ok: false, reason: "inconclusive_failure_evidence" };
}

function evaluateStatusBody(
  status: SettlementStatusBody,
  opts: {
    expectedTx: string;
    env?: EnvRecord;
    expectedPayer?: string | null;
    storedProviderPaymentId?: string | null;
    storedProviderAuthorizationId?: string | null;
    storedSettlementRef?: string | null;
    mode: "settled" | "failed";
  },
):
  | { ok: true; source: "okx_settle_status"; payer?: string; canonicalTx: string }
  | {
      ok: false;
      reason: string;
      keep_review: boolean;
      failed_conclusive?: boolean;
    } {
  // Unconfirmed / unknown → keep review.
  if (
    status.status === "pending" ||
    status.status === "timeout" ||
    (!status.success && !status.status)
  ) {
    return { ok: false, reason: "transaction_unconfirmed", keep_review: true };
  }

  const statusTx = canonicalizeSettlementRef(
    status.transaction || opts.expectedTx,
  );
  if (!statusTx || statusTx !== opts.expectedTx) {
    return { ok: false, reason: "tx_mismatch", keep_review: true };
  }

  if (opts.mode === "failed") {
    const isFailed =
      status.status === "failed" ||
      (status.success === false && status.status !== "success");
    if (!isFailed) {
      if (status.success === true || status.status === "success") {
        return {
          ok: false,
          reason: "evidence_shows_success",
          keep_review: true,
        };
      }
      return {
        ok: false,
        reason: "transaction_unconfirmed",
        keep_review: true,
      };
    }

    // Commercial fields (network, asset, payTo; amount when returned; payer when known).
    const commercial = evaluateCommercialFields(status, {
      env: opts.env,
      expectedPayer: opts.expectedPayer,
      requireAmount: false,
    });
    if (!commercial.ok) {
      return { ok: false, reason: commercial.reason, keep_review: true };
    }

    // Payment-specific binding is mandatory for conclusive failure.
    const specific = evaluatePaymentSpecificBinding({
      expectedTx: opts.expectedTx,
      storedSettlementRef: opts.storedSettlementRef,
      storedProviderPaymentId: opts.storedProviderPaymentId,
      storedProviderAuthorizationId: opts.storedProviderAuthorizationId,
      status,
    });
    if (!specific.ok) {
      return {
        ok: false,
        reason: specific.reason,
        keep_review: true,
      };
    }

    return {
      ok: false,
      reason: status.errorReason || "facilitator_failed",
      keep_review: false,
      failed_conclusive: true,
    };
  }

  // settled mode
  if (status.status === "failed") {
    return {
      ok: false,
      reason: status.errorReason || "facilitator_failed",
      keep_review: false,
      failed_conclusive: true,
    };
  }
  if (status.success === false && status.status !== "success") {
    return {
      ok: false,
      reason: status.errorReason || "facilitator_failed",
      keep_review: false,
      failed_conclusive: true,
    };
  }
  if (status.success !== true && status.status !== "success") {
    return { ok: false, reason: "transaction_unconfirmed", keep_review: true };
  }

  const bound = evaluateCommercialFields(status, {
    env: opts.env,
    expectedPayer: opts.expectedPayer,
    requireAmount: true,
  });
  if (!bound.ok) {
    return { ok: false, reason: bound.reason, keep_review: true };
  }

  return {
    ok: true,
    source: "okx_settle_status",
    payer: status.payer,
    canonicalTx: opts.expectedTx,
  };
}

export async function applySettlementReview(args: {
  paymentId: string;
  decision: SettlementReviewDecision;
  transactionHash?: string;
  evidenceNote?: string;
  reviewerKeyId?: string;
  env?: EnvRecord;
  fetchImpl?: OkxHttpFetch;
  store?: AuthStore;
  statusOverride?: SettlementStatusBody;
}): Promise<SettlementReviewResult> {
  const store = args.store ?? (await getAuthStore({ env: args.env }));
  const paymentId = String(args.paymentId || "").trim();
  const payment = await store.getMonitoringPassPaymentById(paymentId);
  if (!payment) {
    return { ok: false, error: "not_found", http_status: 404 };
  }
  if (
    payment.status !== "settlement_review_required" &&
    payment.status !== "settlement_unknown"
  ) {
    return {
      ok: false,
      error: "invalid_state",
      http_status: 409,
      message: "payment is not in a reviewable state",
      status: payment.status,
    };
  }

  const nowIso = new Date().toISOString();
  const note = String(args.evidenceNote || "")
    .slice(0, 240)
    .replace(/0x[a-fA-F0-9]{16,}/g, "0x[redacted]");
  const auditId = `srev_${randomUUID().replace(/-/g, "").slice(0, 16)}`;

  const rawTx = String(args.transactionHash || "").trim();
  if (!rawTx && args.decision === "settled") {
    return {
      ok: false,
      error: "invalid_input",
      http_status: 400,
      message: "decision=settled requires transaction_hash",
    };
  }
  if (!rawTx && args.decision === "failed") {
    return {
      ok: false,
      error: "invalid_input",
      http_status: 400,
      message:
        "failure decision requires a transaction hash with conclusive facilitator failed status bound to this payment",
    };
  }

  const canonicalTx = canonicalizeSettlementRef(rawTx);
  if (!canonicalTx) {
    return {
      ok: false,
      error: "invalid_input",
      http_status: 400,
      message: "malformed transaction_hash",
      status: "settlement_review_required",
    };
  }

  // Pre-check ownership with canonical ref.
  const priorClaim = await store.getSettlementRefClaim(canonicalTx);
  if (priorClaim && priorClaim.payment_id !== paymentId) {
    return {
      ok: false,
      error: "evidence_bound_to_other_payment",
      http_status: 409,
      message: "Transaction reference is already bound to another payment",
      status: "settlement_review_required",
    };
  }
  const otherPay = await store.getMonitoringPassPaymentBySettlementRef(
    canonicalTx,
  );
  if (otherPay && otherPay.id !== paymentId) {
    return {
      ok: false,
      error: "evidence_bound_to_other_payment",
      http_status: 409,
      message: "Transaction reference belongs to another payment",
      status: "settlement_review_required",
    };
  }
  const otherPass = await store.getMonitoringPassBySettlementRef(canonicalTx);
  if (otherPass && otherPass.payment_id !== paymentId) {
    return {
      ok: false,
      error: "evidence_bound_to_other_payment",
      http_status: 409,
      status: "settlement_review_required",
    };
  }

  if (args.decision === "failed") {
    const ev = await verifySettlementEvidence({
      paymentId,
      transactionHash: canonicalTx,
      env: args.env,
      fetchImpl: args.fetchImpl,
      expectedPayer: payment.payer_address,
      storedProviderPaymentId: payment.provider_payment_id,
      storedProviderAuthorizationId: payment.provider_authorization_id,
      storedSettlementRef: payment.settlement_ref,
      mode: "failed",
      statusOverride: args.statusOverride,
    });
    if (ev.ok) {
      return {
        ok: false,
        error: "evidence_shows_success",
        http_status: 409,
        message: "Facilitator reports success; cannot mark failed",
      };
    }
    if (ev.keep_review || !ev.failed_conclusive) {
      return {
        ok: false,
        error: "inconclusive_failure_evidence",
        http_status: 409,
        message: ev.reason,
        status: "settlement_review_required",
      };
    }

    const claimed = await store.claimSettlementReviewDecision({
      paymentId,
      settlementRef: canonicalTx,
      decision: "failed",
      evidenceSource: "okx_settle_status",
      evidenceRefHash: sha256Hex(canonicalTx),
      reviewerKeyId: args.reviewerKeyId ?? null,
      sanitizedSettleReason: note || ev.reason,
      auditId,
      nowIso,
    });
    if (!claimed.ok) {
      return {
        ok: false,
        error:
          claimed.reason === "ref_already_claimed"
            ? "evidence_bound_to_other_payment"
            : "claim_conflict",
        http_status: 409,
        message: claimed.reason,
        status: "settlement_review_required",
      };
    }
    return { ok: true, payment_id: paymentId, decision: "failed" };
  }

  // settled
  const verified = await verifySettlementEvidence({
    paymentId,
    transactionHash: canonicalTx,
    env: args.env,
    fetchImpl: args.fetchImpl,
    expectedPayer: payment.payer_address,
    storedProviderPaymentId: payment.provider_payment_id,
    storedProviderAuthorizationId: payment.provider_authorization_id,
    storedSettlementRef: payment.settlement_ref,
    mode: "settled",
    statusOverride: args.statusOverride,
  });
  if (!verified.ok) {
    return {
      ok: false,
      error: "evidence_rejected",
      http_status: 422,
      message: verified.reason,
      status: verified.keep_review
        ? "settlement_review_required"
        : payment.status,
    };
  }

  const claimed = await store.claimSettlementReviewDecision({
    paymentId,
    settlementRef: verified.canonicalTx,
    decision: "settled",
    evidenceSource: verified.source,
    evidenceRefHash: sha256Hex(verified.canonicalTx),
    reviewerKeyId: args.reviewerKeyId ?? null,
    payerAddress: verified.payer ?? null,
    sanitizedSettleReason: note || "operator_settled_verified",
    auditId,
    nowIso,
  });
  if (!claimed.ok) {
    return {
      ok: false,
      error:
        claimed.reason === "ref_already_claimed"
          ? "evidence_bound_to_other_payment"
          : "claim_conflict",
      http_status: 409,
      message: claimed.reason,
      status: "settlement_review_required",
    };
  }

  const recon = await reconcilePendingPassSettlements({
    env: args.env,
    limit: 10,
    fetchImpl: args.fetchImpl,
  });

  return {
    ok: true,
    payment_id: paymentId,
    decision: "settled",
    issued: recon.issued,
    issued_pass_ids: recon.issued_pass_ids,
  };
}
