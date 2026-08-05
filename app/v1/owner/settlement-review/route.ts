import { NextResponse } from "next/server";
import { authorizeOwnerRequest } from "@/policy/operations/auth";
import { applySettlementReview } from "@/payments/settlement-review-service";

/**
 * POST /v1/owner/settlement-review
 *
 * Owner-only (OWNER_OPS_SECRET — not general cron).
 * Evidence-based settlement resolution; never fabricates settlement.
 */
async function handle(req: Request) {
  const auth = authorizeOwnerRequest(req);
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
  const evidenceNote = String(body.evidence_note || "");

  if (decision !== "settled" && decision !== "failed") {
    return NextResponse.json(
      {
        error: "invalid_input",
        message: "payment_id and decision (settled|failed) required",
      },
      { status: 400 },
    );
  }

  const result = await applySettlementReview({
    paymentId,
    decision,
    transactionHash: txHash || undefined,
    evidenceNote,
    reviewerKeyId: "owner_ops",
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.error,
        message: result.message,
        status: result.status,
      },
      { status: result.http_status },
    );
  }

  return NextResponse.json({
    ok: true,
    payment_id: result.payment_id,
    decision: result.decision,
    issued: result.issued,
    issued_pass_ids: result.issued_pass_ids,
  });
}

export async function POST(req: Request) {
  return handle(req);
}
