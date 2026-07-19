import { NextResponse } from "next/server";
import { authorizeOwnerRequest } from "@/policy/operations/auth";
import {
  applyOwnerReview,
  isOwnerReviewAction,
} from "@/policy/operations/index";
import { getWebDatabase } from "@/web/db";

/**
 * POST /v1/owner/policy-review — record owner review action.
 * Body: { action: UNCHANGED|MATERIAL_CHANGE_DETECTED|SOURCE_UNAVAILABLE|RETIRED, note?: string }
 * Bearer: OWNER_OPS_SECRET or CRON_SECRET.
 *
 * UNCHANGED restores CURRENT without code deploy.
 * MATERIAL_CHANGE_DETECTED never auto-applies new eligibility rules.
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

  try {
    const db = getWebDatabase();
    const result = applyOwnerReview(db, {
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
        note: "Owner review recorded. Eligibility rules are never auto-applied from material-change flags.",
      },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "review_failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
