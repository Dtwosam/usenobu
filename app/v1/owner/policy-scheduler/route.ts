import { NextResponse } from "next/server";
import { authorizeOwnerRequest } from "@/policy/operations/auth";
import { runPolicyReviewScheduler } from "@/policy/operations/store";
import { getWebDatabase } from "@/web/db";

/**
 * POST /v1/owner/policy-scheduler — idempotent overdue review transition.
 * Marks CURRENT → CHECK_DUE when next_review_at elapsed; creates at most one
 * active owner alert. Does not fetch or scrape Target. Does not auto-approve.
 * Bearer: OWNER_OPS_SECRET or CRON_SECRET.
 */
export async function POST(req: Request) {
  const auth = authorizeOwnerRequest(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const nowIso = new Date().toISOString();
  const db = getWebDatabase();
  const result = runPolicyReviewScheduler(db, nowIso);

  return NextResponse.json(
    {
      ok: true,
      transitioned: result.transitioned,
      alert_created: result.alert_created,
      review_state: result.runtime.effective_state,
      stored_review_state: result.runtime.record.review_state,
      warning: result.runtime.warning,
      next_review_at: result.runtime.record.next_review_at,
      checked_at: nowIso,
      note: "Idempotent policy review scheduler. No Target fetch. No auto-approval.",
    },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}
