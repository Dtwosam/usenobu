import { NextResponse } from "next/server";
import { authorizeOwnerOrCronRequest } from "@/policy/operations/auth";
import { tryGetPolicyOperationsStore } from "@/policy/operations/factory";
import { policyStatusSnapshotOnStore } from "@/policy/operations/service";
import { isPolicyStoreUnavailableError } from "@/policy/operations/contract";

/**
 * GET /v1/owner/policy-status — protected policy operations status.
 * Bearer: OWNER_OPS_SECRET or CRON_SECRET.
 */
export async function GET(req: Request) {
  const auth = authorizeOwnerOrCronRequest(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const nowIso = new Date().toISOString();
  const storeResult = await tryGetPolicyOperationsStore();
  if (!storeResult.ok) {
    return NextResponse.json(
      { error: "policy_ops_store_unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const snap = await policyStatusSnapshotOnStore(storeResult.store, nowIso);
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
        store_kind: snap.store_kind,
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
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    if (isPolicyStoreUnavailableError(err)) {
      return NextResponse.json(
        { error: "policy_ops_store_unavailable" },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: "policy_status_failed" }, { status: 500 });
  }
}
