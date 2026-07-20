import { NextResponse } from "next/server";
import { z } from "zod";
import { auditA2mcp, defaultA2mcpRateLimiter } from "@/a2mcp/index";
import {
  startMonitoringForAgent,
  type StartMonitoringResult,
} from "@/payments/start-monitoring-service";
import { X402_CHALLENGE_HEADER_NAME, X402_PAYMENT_HEADER_NAME } from "@/payments/x402";

/**
 * Lane 7.4D — private, UNREGISTERED paid activation endpoint.
 * Not part of ASP #5541, not advertised, no OKX registration performed.
 * Accepts only quote_id/connection_id/connection_token in the body; the
 * signed payment replay travels in the PAYMENT-SIGNATURE header, never the
 * body. Every other authoritative value is reloaded server-side.
 */

const StartMonitoringBodySchema = z
  .object({
    quote_id: z.string().min(1),
    connection_id: z.string().min(1),
    connection_token: z.string().min(1),
  })
  .strict();

function clientKey(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]?.trim() || "unknown";
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return "local";
}

/** A2MCP agent host, distinct from the consumer web origin (www.usenobu.xyz). */
function resolveResourceUrl(env: NodeJS.ProcessEnv = process.env): string {
  const base =
    env.NOBU_A2MCP_BASE_URL?.trim().replace(/\/$/, "") ||
    "https://usenobu.vercel.app";
  return `${base}/v1/agent/start-monitoring`;
}

function responseBody(result: StartMonitoringResult): Record<string, unknown> {
  const base = { agent_state: "MONITORING_ACTIVATION", status: result.status };
  if (result.ok && result.status === "PAYMENT_SETTLEMENT_PENDING") {
    return {
      ...base,
      note: result.note,
    };
  }
  if (result.ok && "monitoring_deadline" in result) {
    return {
      ...base,
      monitor_id: result.monitor_id,
      monitoring_deadline: result.monitoring_deadline,
    };
  }
  if (result.ok && "monitor_id" in result) {
    return { ...base, monitor_id: result.monitor_id };
  }
  return base;
}

export async function POST(req: Request) {
  const started = Date.now();
  const key = clientKey(req);

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    auditA2mcp({
      at: new Date().toISOString(),
      route: "/v1/agent/start-monitoring",
      client_key: key,
      http_status: 400,
      outcome: "invalid_json",
      duration_ms: Date.now() - started,
    });
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = StartMonitoringBodySchema.safeParse(raw);
  if (!parsed.success) {
    auditA2mcp({
      at: new Date().toISOString(),
      route: "/v1/agent/start-monitoring",
      client_key: key,
      http_status: 400,
      outcome: "invalid_input",
      duration_ms: Date.now() - started,
    });
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const limit = defaultA2mcpRateLimiter.check(key);
  if (!limit.allowed) {
    auditA2mcp({
      at: new Date().toISOString(),
      route: "/v1/agent/start-monitoring",
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

  const paymentAuthorizationHeader = req.headers.get(X402_PAYMENT_HEADER_NAME);

  const result = await startMonitoringForAgent({
    quoteId: parsed.data.quote_id,
    connectionId: parsed.data.connection_id,
    connectionToken: parsed.data.connection_token,
    paymentAuthorizationHeader,
    resource: resolveResourceUrl(),
  });

  auditA2mcp({
    at: new Date().toISOString(),
    route: "/v1/agent/start-monitoring",
    client_key: key,
    http_status: result.http_status,
    outcome: result.status,
    duration_ms: Date.now() - started,
  });

  if (!result.ok && "challenge" in result) {
    return NextResponse.json(responseBody(result), {
      status: 402,
      headers: { [X402_CHALLENGE_HEADER_NAME]: result.challengeHeaderValue },
    });
  }

  return NextResponse.json(responseBody(result), { status: result.http_status });
}
