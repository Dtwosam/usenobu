import { NextResponse } from "next/server";
import { authorizeOwnerOrCronRequest } from "@/policy/operations/auth";
import { reconcilePendingPassSettlements } from "@/payments/monitoring-pass-service";

/**
 * POST /v1/owner/pass-settlement-reconcile — recover Monitoring Pass issuance
 * for durable payments stuck at `verifying` after OKX settle returned pending.
 *
 * Bearer: OWNER_OPS_SECRET or CRON_SECRET.
 *
 * Never re-reads a signed payment header, never creates a second payment
 * challenge, and issues at most one pass per verified settlement_ref.
 * Response includes public pass ids only (no tokens, digests, headers, or
 * settlement transaction hashes).
 */
async function handle(req: Request) {
  const auth = authorizeOwnerOrCronRequest(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const result = await reconcilePendingPassSettlements();
    return NextResponse.json(
      {
        ok: true,
        ...result,
        note: "Pending Monitoring Pass settlements reconciled via official settle/status only. No second charge. Exactly one pass per confirmed settlement.",
      },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "pass_settlement_reconcile_failed" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

/** Vercel Cron invokes GET; owners/scripts may use POST. */
export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}
