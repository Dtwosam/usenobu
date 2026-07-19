import { NextResponse } from "next/server";
import { authorizeCronRequest } from "@/policy/operations/auth";
import { tryGetPolicyOperationsStore } from "@/policy/operations/factory";
import { runPolicyReviewSchedulerOnStore } from "@/policy/operations/service";
import { isPolicyStoreUnavailableError } from "@/policy/operations/contract";

/**
 * POST /v1/owner/policy-scheduler — idempotent overdue review transition.
 * Bearer: CRON_SECRET only.
 * Does not fetch or scrape Target. Does not auto-approve.
 */
export async function POST(req: Request) {
  const auth = authorizeCronRequest(req);
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
    const result = await runPolicyReviewSchedulerOnStore(
      storeResult.store,
      nowIso,
    );
    return NextResponse.json(
      {
        ok: true,
        transitioned: result.transitioned,
        alert_created: result.alert_created,
        review_state: result.runtime.effective_state,
        stored_review_state: result.runtime.record.review_state,
        warning: result.runtime.warning,
        next_review_at: result.runtime.record.next_review_at,
        store_kind: storeResult.store.kind,
        checked_at: nowIso,
        note: "Idempotent policy review scheduler. No Target fetch. No auto-approval.",
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
    return NextResponse.json({ error: "scheduler_failed" }, { status: 500 });
  }
}
