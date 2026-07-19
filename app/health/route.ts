import { NextResponse } from "next/server";
import { isSerpApiConfigured } from "@/serpapi/client";
import { getAiModel, isGroqConfigured } from "@/ai/groq-client";
import { TARGET_US_POLICY } from "@/policy/target-us-policy";
import { tryGetPolicyOperationsStore } from "@/policy/operations/factory";
import { getPolicyRuntimeFromStore } from "@/policy/operations/service";

/**
 * OpenAPI GET /health — free service health.
 * Policy ops from durable shared store only — never invent CURRENT from memory.
 */
export async function GET() {
  const serpapiConfigured = isSerpApiConfigured();
  const groqConfigured = isGroqConfigured();
  const nowIso = new Date().toISOString();

  const storeResult = await tryGetPolicyOperationsStore();
  let policy_review_state: string | null = null;
  let policy_warning: string | null = null;
  let policy_ops_store: "ok" | "unavailable" = "unavailable";
  let policy_ops_store_kind: string | null = null;
  let status: "ok" | "degraded" = "ok";

  if (storeResult.ok) {
    try {
      const runtime = await getPolicyRuntimeFromStore(storeResult.store, nowIso);
      policy_review_state = runtime.effective_state;
      policy_warning = runtime.warning;
      policy_ops_store = "ok";
      policy_ops_store_kind = storeResult.store.kind;
    } catch {
      policy_ops_store = "unavailable";
      status = "degraded";
      policy_warning =
        "Policy operations store is unavailable. Policy state is not assumed CURRENT.";
    }
  } else {
    status = "degraded";
    policy_ops_store = "unavailable";
    policy_warning =
      "Policy operations store is unavailable. Policy state is not assumed CURRENT.";
  }

  return NextResponse.json(
    {
      status,
      service: "nobu-a2mcp",
      version: "1.0.0",
      checked_at: nowIso,
      price_source_type: "THIRD_PARTY_SEARCH_OBSERVATION",
      provider: "SerpApi",
      serpapi_configured: serpapiConfigured,
      provider_ready: serpapiConfigured,
      groq_configured: groqConfigured,
      nobu_ai_model: getAiModel(),
      policy_id: TARGET_US_POLICY.policy_id,
      policy_version: TARGET_US_POLICY.policy_version,
      policy_review_state,
      policy_warning,
      policy_ops_store,
      policy_ops_store_kind,
      note: "Free A2MCP health. Not an official Target API. serpapi_configured and groq_configured are boolean only — no secrets.",
    },
    { status: 200 },
  );
}
