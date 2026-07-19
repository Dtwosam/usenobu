import { NextResponse } from "next/server";
import { authorizeOwnerRequest } from "@/policy/operations/auth";
import { isOwnerReviewAction } from "@/policy/operations/types";
import { tryGetPolicyOperationsStore } from "@/policy/operations/factory";
import { applyOwnerReviewOnStore } from "@/policy/operations/service";
import { isPolicyStoreUnavailableError } from "@/policy/operations/contract";

/**
 * POST /v1/owner/policy-review — record owner review action.
 * Body: { action: UNCHANGED|MATERIAL_CHANGE_DETECTED|SOURCE_UNAVAILABLE|RETIRED, note?: string }
 * Bearer: OWNER_OPS_SECRET only.
 */
export async function POST(req: Request) {
  const auth = authorizeOwnerRequest(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!raw || typeof raw !== "object") {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const body = raw as { action?: unknown; note?: unknown };
  const action = typeof body.action === "string" ? body.action : "";
  if (!isOwnerReviewAction(action)) {
    return NextResponse.json(
      {
        error: "invalid_action",
        allowed: [
          "UNCHANGED",
          "MATERIAL_CHANGE_DETECTED",
          "SOURCE_UNAVAILABLE",
          "RETIRED",
        ],
      },
      { status: 400 },
    );
  }

  const note =
    typeof body.note === "string" && body.note.trim()
      ? body.note.trim().slice(0, 2000)
      : null;

  const storeResult = await tryGetPolicyOperationsStore();
  if (!storeResult.ok) {
    return NextResponse.json(
      { error: "policy_ops_store_unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const result = await applyOwnerReviewOnStore(storeResult.store, {
      action,
      note,
      actor: auth.actor,
    });
    return NextResponse.json(
      {
        ok: true,
        action,
        record: result.record,
        pending_review_id: result.pending_review_id ?? null,
        store_kind: storeResult.store.kind,
        note: "Owner review recorded. Eligibility rules are never auto-applied from material-change flags.",
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
    const message = err instanceof Error ? err.message : "review_failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
