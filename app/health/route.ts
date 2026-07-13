import { NextResponse } from "next/server";
import { isSerpApiConfigured } from "@/serpapi/client";

/**
 * OpenAPI GET /health — free service health.
 * Reports whether SerpApi is configured without exposing the key.
 */
export async function GET() {
  const serpapiConfigured = isSerpApiConfigured();
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
      note: "Free A2MCP health. Not an official Target API. serpapi_configured is boolean only — no secrets.",
    },
    { status: 200 },
  );
}
