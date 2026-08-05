import { NextResponse } from "next/server";
import { authorizeCronRequest } from "@/policy/operations/auth";
import { getAuthStore } from "@/auth/auth-store";

/**
 * POST /v1/owner/settlement-review
 *
 * Operator resolution for settlement_review_required payments.
 * Never fabricates settlement — requires verified evidence fields.
 *
 * Body:
 *   payment_id: string
 *   decision: "settled" | "failed"
 *   transaction_hash?: string  (required when decision=settled)
 *   evidence_note?: string     (sanitized; no signatures)
 */
async function handle(req: Request) {
  const auth = authorizeCronRequest(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const paymentId = String(body.payment_id || "").trim();
  const decision = String(body.decision || "").trim();
  const txHash = String(body.transaction_hash || "").trim();
  const evidenceNote = String(body.evidence_note || "")
    .slice(0, 240)
    .replace(/0x[a-fA-F0-9]{16,}/g, "0x[redacted]");

  if (!paymentId || (decision !== "settled" && decision !== "failed")) {
    return NextResponse.json(
      {
        error: "invalid_input",
        message: "payment_id and decision (settled|failed) required",
      },
      { status: 400 },
    );
  }
  if (decision === "settled" && !/^0x[a-fA-F0-9]{16,}$/.test(txHash)) {
    return NextResponse.json(
      {
        error: "invalid_input",
        message:
          "decision=settled requires verified transaction_hash evidence",
      },
      { status: 400 },
    );
  }

  const store = await getAuthStore();
  const payment = await store.getMonitoringPassPaymentById(paymentId);
  if (!payment) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (
    payment.status !== "settlement_review_required" &&
    payment.status !== "settlement_unknown"
  ) {
    return NextResponse.json(
      {
        error: "invalid_state",
        message: "payment is not in a reviewable state",
        status: payment.status,
      },
      { status: 409 },
    );
  }

  const nowIso = new Date().toISOString();
  if (decision === "failed") {
    await store.updateMonitoringPassPayment({
      id: paymentId,
      status: "failed",
      settlementRef: null,
      nowIso,
      sanitizedSettleReason: evidenceNote || "operator_failed",
      lastProviderOperation: "operator_review",
    });
    return NextResponse.json({
      ok: true,
      payment_id: paymentId,
      decision: "failed",
      note: "Marked failed after operator evidence. Do not auto-fabricate settlement.",
    });
  }

  // settled with verified tx evidence — issue path remains UNIQUE settlement_ref
  await store.updateMonitoringPassPayment({
    id: paymentId,
    status: "settled",
    settlementRef: txHash,
    nowIso,
    sanitizedSettleReason: evidenceNote || "operator_settled",
    lastProviderOperation: "operator_review",
  });

  // Best-effort pass issue via reconcile
  const { reconcilePendingPassSettlements } = await import(
    "@/payments/monitoring-pass-service"
  );
  const recon = await reconcilePendingPassSettlements({ limit: 5 });

  return NextResponse.json({
    ok: true,
    payment_id: paymentId,
    decision: "settled",
    transaction_hash_present: true,
    issued: recon.issued,
    issued_pass_ids: recon.issued_pass_ids,
  });
}

export async function POST(req: Request) {
  return handle(req);
}
