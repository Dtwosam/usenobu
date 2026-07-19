import { NextResponse } from "next/server";
import { authorizeOwnerRequest } from "@/policy/operations/auth";
import { policyStatusSnapshot } from "@/policy/operations/store";
import { getWebDatabase } from "@/web/db";

/**
 * GET /v1/owner/policy-status — protected policy operations status.
 * Bearer: OWNER_OPS_SECRET or CRON_SECRET.
 */
export async function GET(req: Request) {
  const auth = authorizeOwnerRequest(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const nowIso = new Date().toISOString();
  const db = getWebDatabase();
  const snap = policyStatusSnapshot(db, nowIso);

  return NextResponse.json(
    {
      policy_id: snap.runtime.record.policy_id,
      policy_version: snap.runtime.record.policy_version,
      review_state: snap.runtime.effective_state,
      stored_review_state: snap.runtime.record.review_state,
      approved_at: snap.runtime.record.approved_at,
      source_url: snap.runtime.record.source_url,
      source_last_checked_at: snap.runtime.record.source_last_checked_at,
      next_review_at: snap.runtime.record.next_review_at,
      warning: snap.runtime.warning,
      owner_action_required: snap.runtime.owner_action_required,
      suppress_positive_eligibility: snap.runtime.suppress_positive_eligibility,
      block_positive_service: snap.runtime.block_positive_service,
      active_owner_alerts: snap.active_owner_alerts,
      pending_reviews: snap.pending_reviews,
      alerts: snap.alerts.map((a) => ({
        id: a.id,
        alert_type: a.alert_type,
        status: a.status,
        message: a.message,
        created_at: a.created_at,
      })),
      checked_at: nowIso,
      note: "Owner policy status. Official Target source is reviewed manually. No Target scrape.",
    },
    {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
