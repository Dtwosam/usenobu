import { NextResponse } from "next/server";
import { auditA2mcp, defaultA2mcpRateLimiter } from "@/a2mcp/index";
import { runAgentAction } from "@/ai/agent-service";
import { aiAgentRateLimiter } from "@/ai/rate-limit";

function clientKey(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]?.trim() || "unknown";
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return "local";
}

/**
 * POST /v1/agent — bounded A2MCP agent actions only.
 * UNDERSTAND_PURCHASE | CHECK_CONFIRMED_PURCHASE | CHECK_MONITORING_STATUS
 */
export async function POST(req: Request) {
  const started = Date.now();
  const key = clientKey(req);

  // AI actions get stricter limit; others share default A2MCP limit
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    auditA2mcp({
      at: new Date().toISOString(),
      route: "/v1/agent",
      client_key: key,
      http_status: 400,
      outcome: "invalid_json",
      duration_ms: Date.now() - started,
    });
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

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
      return NextResponse.json(
        { error: "rejected_sensitive_fields" },
        { status: 400 },
      );
    }
  }

  const action =
    raw && typeof raw === "object" && "action" in raw
      ? String((raw as { action: unknown }).action)
      : "";

  const limiter =
    action === "UNDERSTAND_PURCHASE"
      ? aiAgentRateLimiter
      : defaultA2mcpRateLimiter;
  const limit = limiter.check(key);
  if (!limit.allowed) {
    auditA2mcp({
      at: new Date().toISOString(),
      route: "/v1/agent",
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
        },
      },
    );
  }

  // Never log raw purchase_text
  const result = await runAgentAction(raw);

  auditA2mcp({
    at: new Date().toISOString(),
    route: "/v1/agent",
    client_key: key,
    http_status: result.http_status,
    outcome:
      "body" in result &&
      result.body &&
      typeof result.body === "object" &&
      "agent_state" in result.body
        ? String((result.body as { agent_state: string }).agent_state)
        : "error" in result.body
          ? String((result.body as { error: string }).error)
          : "ok",
    duration_ms: Date.now() - started,
  });

  return NextResponse.json(result.body, { status: result.http_status });
}
