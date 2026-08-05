import { NextResponse } from "next/server";
import { authorizeOwnerRequest } from "@/policy/operations/auth";
import { getConfigReadiness } from "@/ops/config-readiness";

/**
 * GET /v1/owner/config-readiness
 *
 * Owner-only. Returns booleans only — never secret values, lengths, hashes,
 * or prefixes. Safe Production probe before any real payment.
 */
export async function GET(req: Request) {
  const auth = authorizeOwnerRequest(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const readiness = getConfigReadiness(process.env);
  return NextResponse.json({
    ok: true,
    ...readiness,
  });
}
