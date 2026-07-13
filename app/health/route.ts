import { NextResponse } from "next/server";

/**
 * OpenAPI GET /health — free service health.
 */
export async function GET() {
  return NextResponse.json(
    {
      status: "ok",
      service: "afterbuy-a2mcp",
      version: "1.0.0",
      checked_at: new Date().toISOString(),
      price_source_type: "THIRD_PARTY_SEARCH_OBSERVATION",
      provider: "SerpApi",
      note: "Free A2MCP health. Not an official Target API.",
    },
    { status: 200 },
  );
}
