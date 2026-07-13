import { NextResponse } from "next/server";
import {
  auditA2mcp,
  defaultA2mcpRateLimiter,
  runA2mcpTargetPriceCheck,
} from "@/a2mcp/index";

function clientKey(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]?.trim() || "unknown";
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return "local";
}

/**
 * OpenAPI POST /v1/target-price-check
 * Free HTTP 200 JSON A2MCP one-time check. No x402.
 */
export async function POST(req: Request) {
  const started = Date.now();
  const key = clientKey(req);

  const limit = defaultA2mcpRateLimiter.check(key);
  if (!limit.allowed) {
    auditA2mcp({
      at: new Date().toISOString(),
      route: "/v1/target-price-check",
      client_key: key,
      http_status: 429,
      outcome: "rate_limited",
      duration_ms: Date.now() - started,
    });
    return NextResponse.json(
      { error: "rate_limited" },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(limit.retry_after_ms / 1000) || 1),
          "X-RateLimit-Remaining": "0",
        },
      },
    );
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    auditA2mcp({
      at: new Date().toISOString(),
      route: "/v1/target-price-check",
      client_key: key,
      http_status: 400,
      outcome: "invalid_json",
      duration_ms: Date.now() - started,
    });
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  // Reject obviously sensitive payloads even if they fail strict schema
  if (raw && typeof raw === "object") {
    const keys = Object.keys(raw as object).map((k) => k.toLowerCase());
    const banned = [
      "password",
      "card_number",
      "cvv",
      "private_key",
      "seed_phrase",
      "2fa",
      "otp",
    ];
    if (keys.some((k) => banned.some((b) => k.includes(b)))) {
      auditA2mcp({
        at: new Date().toISOString(),
        route: "/v1/target-price-check",
        client_key: key,
        http_status: 400,
        outcome: "rejected_sensitive_fields",
        duration_ms: Date.now() - started,
      });
      return NextResponse.json(
        { error: "invalid_input", details: "sensitive_fields_not_allowed" },
        { status: 400 },
      );
    }
  }

  const result = await runA2mcpTargetPriceCheck(raw, {
    skipPolicyFreshness: process.env.A2MCP_SKIP_POLICY_FRESHNESS === "1",
  });

  auditA2mcp({
    at: new Date().toISOString(),
    route: "/v1/target-price-check",
    client_key: key,
    http_status: result.http_status,
    outcome:
      "status" in result.body
        ? String(result.body.status)
        : String((result.body as { error?: string }).error ?? "ok"),
    duration_ms: Date.now() - started,
  });

  return NextResponse.json(result.body, {
    status: result.http_status,
    headers: {
      "X-RateLimit-Remaining": String(limit.remaining),
      "Cache-Control": "no-store",
    },
  });
}
