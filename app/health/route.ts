import { NextResponse } from "next/server";
import { isSerpApiConfigured } from "@/serpapi/client";
import { getAiModel, isGroqConfigured } from "@/ai/groq-client";

/**
 * OpenAPI GET /health — free service health.
 * Reports SerpApi / Groq configuration without exposing keys or purchase text.
 */
export async function GET() {
  const serpapiConfigured = isSerpApiConfigured();
  const groqConfigured = isGroqConfigured();
  return NextResponse.json(
    {
      status: "ok",
      service: "nobu-a2mcp",
      version: "1.0.0",
      checked_at: new Date().toISOString(),
      price_source_type: "THIRD_PARTY_SEARCH_OBSERVATION",
      provider: "SerpApi",
      serpapi_configured: serpapiConfigured,
      provider_ready: serpapiConfigured,
      /** Boolean only — never the key or partial secret. */
      groq_configured: groqConfigured,
      /** Configured extraction model name (safe). */
      nobu_ai_model: getAiModel(),
      note: "Free A2MCP health. Not an official Target API. serpapi_configured and groq_configured are boolean only — no secrets.",
    },
    { status: 200 },
  );
}
