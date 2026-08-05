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
};

/**
 * Independently verify a transaction via official settle/status and all
 * locked commercial terms. Missing fields keep review (not success).
 */
export async function verifySettlementEvidence(args: {
  paymentId: string;
  transactionHash: string;
  env?: EnvRecord;
  fetchImpl?: OkxHttpFetch;
  /** Known payer from the payment row (if any). */
  expectedPayer?: string | null;
  /** When true, require full commercial success fields (settled path). */
  requireSuccessFields?: boolean;
  statusOverride?: SettlementStatusBody;
}): Promise<
  | { ok: true; source: "okx_settle_status"; payer?: string }
  | { ok: false; reason: string; keep_review: boolean; failed_conclusive?: boolean }
> {
  const tx = String(args.transactionHash || "").trim();
  if (!/^0x[a-fA-F0-9]{16,}$/.test(tx)) {
    return { ok: false, reason: "malformed_tx_hash", keep_review: true };
  }

  if (args.statusOverride) {
    return evaluateStatusBody(args.statusOverride, {
      expectedTx: tx,
      env: args.env,
      expectedPayer: args.expectedPayer,
      requireSuccessFields: args.requireSuccessFields !== false,
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
    const status = await client.getSettleStatus(tx);
    return evaluateStatusBody(status, {
      expectedTx: tx,
      env: args.env,
      expectedPayer: args.expectedPayer,
      requireSuccessFields: args.requireSuccessFields !== false,
    });
  } catch {
    return {
      ok: false,
      reason: "facilitator_status_unavailable",
      keep_review: true,
    };
  }
}

function evaluateStatusBody(
  status: SettlementStatusBody,
  opts: {
    expectedTx: string;
    env?: EnvRecord;
    expectedPayer?: string | null;
    requireSuccessFields: boolean;
  },
):
  | { ok: true; source: "okx_settle_status"; payer?: string }
  | {
      ok: false;
      reason: string;
      keep_review: boolean;
      failed_conclusive?: boolean;
    } {
  // Unconfirmed / unknown → keep review; never unlock payment.
  if (
    status.status === "pending" ||
    status.status === "timeout" ||
    (!status.success && !status.status)
  ) {
    return { ok: false, reason: "transaction_unconfirmed", keep_review: true };
  }

  // Conclusive failure path (for decision=failed only; settled path rejects).
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

  const tx = String(status.transaction || opts.expectedTx).trim();
  if (tx.toLowerCase() !== opts.expectedTx.toLowerCase()) {
    return { ok: false, reason: "tx_mismatch", keep_review: true };
  }

  // For settled decisions, all commercial fields are required (not optional).
  if (opts.requireSuccessFields) {
    const network = String(status.network || "").trim();
    if (!network) {
      return { ok: false, reason: "network_missing", keep_review: true };
    }
    if (network !== DEFAULT_SETTLEMENT_NETWORK) {
      return { ok: false, reason: "network_mismatch", keep_review: true };
    }

    if (status.amount == null || String(status.amount).trim() === "") {
      return { ok: false, reason: "amount_missing", keep_review: true };
    }
    if (String(status.amount) !== MONITORING_PRICE_ATOMIC_UNITS) {
      return { ok: false, reason: "amount_mismatch", keep_review: true };
    }

    if (status.asset == null || String(status.asset).trim() === "") {
      return { ok: false, reason: "asset_missing", keep_review: true };
    }
    if (
      String(status.asset).toLowerCase() !==
      DEFAULT_SETTLEMENT_ASSET.toLowerCase()
    ) {
      return { ok: false, reason: "asset_mismatch", keep_review: true };
    }

    const configuredPayTo = loadOkxSellerConfig(
      opts.env ?? process.env,
    )?.payTo;
    if (!configuredPayTo) {
      return { ok: false, reason: "payto_not_configured", keep_review: true };
    }
    const recipient = String(status.payTo || status.recipient || "").trim();
    if (!recipient) {
      return { ok: false, reason: "recipient_missing", keep_review: true };
    }
    if (recipient.toLowerCase() !== configuredPayTo.toLowerCase()) {
      return { ok: false, reason: "recipient_mismatch", keep_review: true };
    }

    const expectedPayer = String(opts.expectedPayer || "").trim();
    if (expectedPayer) {
      const statusPayer = String(status.payer || "").trim();
      if (!statusPayer) {
        return { ok: false, reason: "payer_missing", keep_review: true };
      }
      if (statusPayer.toLowerCase() !== expectedPayer.toLowerCase()) {
        return { ok: false, reason: "payer_mismatch", keep_review: true };
      }
    }
  }

  return {
    ok: true,
    source: "okx_settle_status",
    payer: status.payer,
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

  if (args.decision === "failed") {
    if (!args.transactionHash) {
      return {
        ok: false,
        error: "invalid_input",
        http_status: 400,
        message:
          "failure decision requires a transaction hash with conclusive facilitator failed status",
      };
    }
    const tx = String(args.transactionHash).trim();
    // Pre-check ownership: unrelated failed tx must not unlock this payment.
    const priorClaim = await store.getSettlementRefClaim(tx);
    if (priorClaim && priorClaim.payment_id !== paymentId) {
      return {
        ok: false,
        error: "evidence_bound_to_other_payment",
        http_status: 409,
        message: "Transaction reference is already bound to another payment",
        status: "settlement_review_required",
      };
    }
    const otherPay = await store.getMonitoringPassPaymentBySettlementRef(tx);
    if (otherPay && otherPay.id !== paymentId) {
      return {
        ok: false,
        error: "evidence_bound_to_other_payment",
        http_status: 409,
        message: "Transaction reference belongs to another payment",
        status: "settlement_review_required",
      };
    }
    const otherPass = await store.getMonitoringPassBySettlementRef(tx);
    if (otherPass && otherPass.payment_id !== paymentId) {
      return {
        ok: false,
        error: "evidence_bound_to_other_payment",
        http_status: 409,
        status: "settlement_review_required",
      };
    }

    const ev = await verifySettlementEvidence({
      paymentId,
      transactionHash: tx,
      env: args.env,
      fetchImpl: args.fetchImpl,
      expectedPayer: payment.payer_address,
      requireSuccessFields: false,
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
      settlementRef: tx,
      decision: "failed",
      evidenceSource: "okx_settle_status",
      evidenceRefHash: sha256Hex(tx),
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
  const tx = String(args.transactionHash || "").trim();
  if (!tx) {
    return {
      ok: false,
      error: "invalid_input",
      http_status: 400,
      message: "decision=settled requires transaction_hash",
    };
  }

  const verified = await verifySettlementEvidence({
    paymentId,
    transactionHash: tx,
    env: args.env,
    fetchImpl: args.fetchImpl,
    expectedPayer: payment.payer_address,
    requireSuccessFields: true,
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
    settlementRef: tx,
    decision: "settled",
    evidenceSource: verified.source,
    evidenceRefHash: sha256Hex(tx),
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
