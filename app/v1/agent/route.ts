import { NextResponse } from "next/server";
import { auditA2mcp, defaultA2mcpRateLimiter } from "@/a2mcp/index";
import {
  buildFreeServiceDescriptor,
  isFirstContactRequest,
  NOBU_DOCUMENTATION_URL,
} from "@/a2mcp/service-descriptor";
import { logA2mcpRequest, parseContentLength } from "@/a2mcp/request-log";
import { runAgentAction } from "@/ai/agent-service";
import { aiAgentRateLimiter } from "@/ai/rate-limit";

const ROUTE = "/v1/agent";

function clientKey(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]?.trim() || "unknown";
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return "local";
}

function descriptorResponse(): NextResponse {
  return NextResponse.json(buildFreeServiceDescriptor(), { status: 200 });
}

/**
 * GET /v1/agent — compatibility path (Lane 8R.3B).
 *
 * A2MCP callers and OKX's own endpoint validator probe with GET before
 * sending a business request. Returning the same descriptor as an unshaped
 * POST means first contact always yields something usable instead of the
 * bodyless 405 that Lane 8R.3A proved was returned.
 */
export async function GET(req: Request) {
  const started = Date.now();
  const res = descriptorResponse();
  logA2mcpRequest({
    route: ROUTE,
    method: "GET",
    contentType: req.headers.get("content-type"),
    contentLength: parseContentLength(req.headers.get("content-length")),
    body: null,
    recognisedAction: null,
    httpStatus: 200,
    durationMs: Date.now() - started,
    outcome: "service_descriptor",
  });
  return res;
}

/**
 * POST /v1/agent — bounded A2MCP agent actions only.
 * Free actions include UNDERSTAND_PURCHASE, CHECK_CONFIRMED_PURCHASE,
 * CHECK_MONITORING_STATUS, Lane 7.4B–7.4E connection/preflight/management,
 * and Lane 8R.3B REDEEM_MONITORING_PASS.
 *
 * A bodyless call, `{}`, or any unrecognised envelope returns the same 200
 * descriptor as GET — computed purely, with no AI, search, email, or
 * database work on that path.
 */
export async function POST(req: Request) {
  const started = Date.now();
  const key = clientKey(req);
  const contentType = req.headers.get("content-type");
  const contentLength = parseContentLength(req.headers.get("content-length"));

  // Read as text first so an absent body is distinguishable from malformed JSON.
  let bodyText: string;
  try {
    bodyText = await req.text();
  } catch {
    bodyText = "";
  }

  let raw: unknown = null;
  if (bodyText.trim().length > 0) {
    try {
      raw = JSON.parse(bodyText);
    } catch {
      auditA2mcp({
        at: new Date().toISOString(),
        route: ROUTE,
        client_key: key,
        http_status: 400,
        outcome: "invalid_json",
        duration_ms: Date.now() - started,
      });
      logA2mcpRequest({
        route: ROUTE,
        method: "POST",
        contentType,
        contentLength,
        body: null,
        recognisedAction: null,
        httpStatus: 400,
        durationMs: Date.now() - started,
        outcome: "invalid_json",
      });
      // Guided 400 — a malformed body is the one case that stays an error,
      // but it still tells the caller how to succeed.
      return NextResponse.json(
        {
          error: "invalid_json",
          status: "INVALID_JSON",
          message:
            "The request body was not valid JSON. Send a JSON object with an `action` field, or send an empty body to receive the list of supported actions.",
          next_action:
            "Retry with `{}` (or no body) to receive the service descriptor.",
          documentation: NOBU_DOCUMENTATION_URL,
        },
        { status: 400 },
      );
    }
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
      logA2mcpRequest({
        route: ROUTE,
        method: "POST",
        contentType,
        contentLength,
        body: raw,
        recognisedAction: null,
        httpStatus: 400,
        durationMs: Date.now() - started,
        outcome: "rejected_sensitive_fields",
      });
      return NextResponse.json(
        { error: "rejected_sensitive_fields" },
        { status: 400 },
      );
    }
  }

  // First contact — no recognised action. Pure descriptor, no dependencies.
  if (isFirstContactRequest(raw)) {
    auditA2mcp({
      at: new Date().toISOString(),
      route: ROUTE,
      client_key: key,
      http_status: 200,
      outcome: "service_descriptor",
      duration_ms: Date.now() - started,
    });
    logA2mcpRequest({
      route: ROUTE,
      method: "POST",
      contentType,
      contentLength,
      body: raw,
      recognisedAction: null,
      httpStatus: 200,
      durationMs: Date.now() - started,
      outcome: "service_descriptor",
    });
    return descriptorResponse();
  }

  const action = String((raw as { action: unknown }).action);

  const limiter =
    action === "UNDERSTAND_PURCHASE"
      ? aiAgentRateLimiter
      : defaultA2mcpRateLimiter;
  const limit = limiter.check(key);
  if (!limit.allowed) {
    auditA2mcp({
      at: new Date().toISOString(),
      route: ROUTE,
      client_key: key,
      http_status: 429,
      outcome: "rate_limited",
      duration_ms: Date.now() - started,
    });
    logA2mcpRequest({
      route: ROUTE,
      method: "POST",
      contentType,
      contentLength,
      body: raw,
      recognisedAction: action,
      httpStatus: 429,
      durationMs: Date.now() - started,
      outcome: "rate_limited",
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
  const result = await runAgentAction(raw, { sourceKey: key });

  const outcome =
    "body" in result &&
    result.body &&
    typeof result.body === "object" &&
    "agent_state" in result.body
      ? String((result.body as { agent_state: string }).agent_state)
      : "error" in result.body
        ? String((result.body as { error: string }).error)
        : "ok";

  auditA2mcp({
    at: new Date().toISOString(),
    route: ROUTE,
    client_key: key,
    http_status: result.http_status,
    outcome,
    duration_ms: Date.now() - started,
  });
  logA2mcpRequest({
    route: ROUTE,
    method: "POST",
    contentType,
    contentLength,
    body: raw,
    recognisedAction: action,
    httpStatus: result.http_status,
    durationMs: Date.now() - started,
    outcome,
    clientDisconnected: req.signal?.aborted ?? false,
  });

  return NextResponse.json(result.body, { status: result.http_status });
}
