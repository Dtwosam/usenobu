/**
 * Evidence-based settlement review for settlement_review_required payments.
 * Never fabricates settlement from an operator-supplied hash alone.
 */
import { createHash, randomUUID } from "node:crypto";
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

/**
 * Independently verify a transaction via official settle/status (when known)
 * and locked commercial terms. Does not accept fabricated hashes.
 */
export async function verifySettlementEvidence(args: {
  paymentId: string;
  transactionHash: string;
  env?: EnvRecord;
  fetchImpl?: OkxHttpFetch;
  /** Test inject: override facilitator status body. */
  statusOverride?: {
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
}): Promise<
  | { ok: true; source: "okx_settle_status"; payer?: string }
  | { ok: false; reason: string; keep_review: boolean }
> {
  const tx = String(args.transactionHash || "").trim();
  if (!/^0x[a-fA-F0-9]{16,}$/.test(tx)) {
    return { ok: false, reason: "malformed_tx_hash", keep_review: true };
  }

  if (args.statusOverride) {
    return evaluateStatusBody(args.statusOverride, tx, args.env);
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
    return evaluateStatusBody(status, tx, args.env);
  } catch {
    return {
      ok: false,
      reason: "facilitator_status_unavailable",
      keep_review: true,
    };
  }
}

function evaluateStatusBody(
  status: {
    success: boolean;
    status?: string;
    transaction?: string;
    network?: string;
    payer?: string;
    amount?: string;
    /** When facilitator returns recipient / payTo. */
    payTo?: string;
    recipient?: string;
    asset?: string;
    errorReason?: string;
  },
  expectedTx: string,
  env?: EnvRecord,
):
  | { ok: true; source: "okx_settle_status"; payer?: string }
  | { ok: false; reason: string; keep_review: boolean } {
  // Unconfirmed / unknown → keep review; never unlock payment.
  if (
    status.status === "pending" ||
    status.status === "timeout" ||
    (!status.success && !status.status)
  ) {
    return { ok: false, reason: "transaction_unconfirmed", keep_review: true };
  }
  // Conclusive failure only when facilitator says failed.
  if (status.status === "failed") {
    return {
      ok: false,
      reason: status.errorReason || "facilitator_failed",
      keep_review: false,
    };
  }
  if (status.success === false && status.status !== "success") {
    return {
      ok: false,
      reason: status.errorReason || "facilitator_failed",
      keep_review: false,
    };
  }
  // Require success path for settled.
  if (status.success !== true && status.status !== "success") {
    return { ok: false, reason: "transaction_unconfirmed", keep_review: true };
  }
  const tx = String(status.transaction || expectedTx).trim();
  if (tx.toLowerCase() !== expectedTx.toLowerCase()) {
    return { ok: false, reason: "tx_mismatch", keep_review: true };
  }
  // Network must be eip155:196 when present; require presence for settle.
  const network = String(status.network || "").trim();
  if (network && network !== DEFAULT_SETTLEMENT_NETWORK) {
    return { ok: false, reason: "network_mismatch", keep_review: true };
  }
  if (!network) {
    // Fail closed: without network confirmation do not settle.
    return { ok: false, reason: "network_missing", keep_review: true };
  }
  // Amount when returned must match locked atomic units (990000).
  if (
    status.amount != null &&
    String(status.amount) !== MONITORING_PRICE_ATOMIC_UNITS
  ) {
    return { ok: false, reason: "amount_mismatch", keep_review: true };
  }
  // Asset when returned must match locked USD₮0 address.
  if (
    status.asset != null &&
    String(status.asset).toLowerCase() !==
      DEFAULT_SETTLEMENT_ASSET.toLowerCase()
  ) {
    return { ok: false, reason: "asset_mismatch", keep_review: true };
  }
  // Recipient/payTo when returned must match configured payTo.
  const configuredPayTo = loadOkxSellerConfig(env ?? process.env)?.payTo;
  const recipient = String(status.payTo || status.recipient || "").trim();
  if (recipient && configuredPayTo) {
    if (recipient.toLowerCase() !== configuredPayTo.toLowerCase()) {
      return { ok: false, reason: "recipient_mismatch", keep_review: true };
    }
  } else if (recipient && !configuredPayTo) {
    return { ok: false, reason: "payto_not_configured", keep_review: true };
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
  statusOverride?: Parameters<typeof verifySettlementEvidence>[0]["statusOverride"];
}): Promise<SettlementReviewResult> {
  const store =
    args.store ?? (await getAuthStore({ env: args.env }));
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

  if (args.decision === "failed") {
    // Require conclusive facilitator evidence — do not fail on uncertainty.
    if (!args.transactionHash) {
      return {
        ok: false,
        error: "invalid_input",
        http_status: 400,
        message:
          "failure decision requires a transaction hash with conclusive facilitator failed status",
      };
    }
    const ev = await verifySettlementEvidence({
      paymentId,
      transactionHash: args.transactionHash,
      env: args.env,
      fetchImpl: args.fetchImpl,
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
    if (ev.keep_review) {
      return {
        ok: false,
        error: "inconclusive_failure_evidence",
        http_status: 409,
        message: ev.reason,
        status: "settlement_review_required",
      };
    }
    await store.updateMonitoringPassPayment({
      id: paymentId,
      status: "failed",
      settlementRef: null,
      nowIso,
      sanitizedSettleReason: note || ev.reason,
      lastProviderOperation: "operator_review",
    });
    await store.insertSettlementReviewAudit({
      id: `srev_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
      paymentId,
      decision: "failed",
      evidenceSource: "okx_settle_status",
      evidenceRefHash: sha256Hex(args.transactionHash),
      reviewerKeyId: args.reviewerKeyId ?? null,
      nowIso,
    });
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

  await store.updateMonitoringPassPayment({
    id: paymentId,
    status: "settled",
    settlementRef: tx,
    nowIso,
    payerAddress: verified.payer ?? null,
    sanitizedSettleReason: note || "operator_settled_verified",
    lastProviderOperation: "operator_review",
  });
  await store.insertSettlementReviewAudit({
    id: `srev_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    paymentId,
    decision: "settled",
    evidenceSource: verified.source,
    evidenceRefHash: createHash("sha256").update(tx).digest("hex"),
    reviewerKeyId: args.reviewerKeyId ?? null,
    nowIso,
  });

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
