import { NextResponse } from "next/server";
import { auditA2mcp, defaultA2mcpRateLimiter } from "@/a2mcp/index";
import {
  isFirstContactRequest,
  NOBU_DOCUMENTATION_URL,
} from "@/a2mcp/service-descriptor";
import {
  buildServiceSelectionRequired,
  buildServiceSelectedResponse,
  DESCRIBE_SERVICES_ACTION,
  SELECT_SERVICE_ACTION,
  isServiceDiscoveryAction,
} from "@/a2mcp/service-catalogue";
import {
  isMarketplaceJourneyRequest,
  runMarketplaceJourney,
} from "@/a2mcp/marketplace-journey";
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

/**
 * Generic Agent-5541 first contact — present both services, require service_id.
 * Pure: no DB/AI work. Payment is not required until service 35958 is selected.
 */
function serviceSelectionResponse(): NextResponse {
  return NextResponse.json(buildServiceSelectionRequired(), { status: 400 });
}

/**
 * GET /v1/agent — validation/input-discovery path.
 *
 * Official Onchain OS 4.4.0 probes with GET before a business request.
 * Generic Agent contact returns SERVICE_SELECTION_REQUIRED with both
 * registered services — never assumes paid service or payment.
 */
export async function GET(req: Request) {
  const started = Date.now();
  const res = serviceSelectionResponse();
  logA2mcpRequest({
    route: ROUTE,
    method: "GET",
    contentType: req.headers.get("content-type"),
    contentLength: parseContentLength(req.headers.get("content-length")),
    body: null,
    recognisedAction: DESCRIBE_SERVICES_ACTION,
    httpStatus: 400,
    durationMs: Date.now() - started,
    outcome: "SERVICE_SELECTION_REQUIRED",
  });
  return res;
}

/**
 * POST /v1/agent — bounded A2MCP agent actions only.
 * Free actions include UNDERSTAND_PURCHASE, CHECK_CONFIRMED_PURCHASE,
 * CHECK_MONITORING_STATUS, Lane 7.4B–7.4E connection/preflight/management,
 * and Lane 8R.3B REDEEM_MONITORING_PASS.
 *
 * A bodyless call, `{}`, or any unrecognised envelope returns the same 400
 * input-required response as GET — computed purely, with no AI, search,
 * email, or database work on that path.
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
            "The request body was not valid JSON. Send a JSON object with an `action` field and that action's required fields.",
          next_action:
            "Retry with a supported `action`; use an empty validation request to receive the required input metadata.",
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

  // Marketplace Purchase Setup never accepts or exposes Nobu's internal
  // action enum. Existing low-level action requests remain backward-compatible.
  if (isMarketplaceJourneyRequest(raw)) {
    const result = await runMarketplaceJourney(raw, { sourceKey: key });
    return NextResponse.json(result.body, { status: result.http_status });
  }

  // Service discovery machine actions (DESCRIBE_SERVICES / SELECT_SERVICE).
  if (
    raw &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    isServiceDiscoveryAction((raw as { action?: unknown }).action)
  ) {
    const discoveryAction = String((raw as { action: unknown }).action);
    if (discoveryAction === DESCRIBE_SERVICES_ACTION) {
      auditA2mcp({
        at: new Date().toISOString(),
        route: ROUTE,
        client_key: key,
        http_status: 400,
        outcome: "SERVICE_SELECTION_REQUIRED",
        duration_ms: Date.now() - started,
      });
      logA2mcpRequest({
        route: ROUTE,
        method: "POST",
        contentType,
        contentLength,
        body: raw,
        recognisedAction: DESCRIBE_SERVICES_ACTION,
        httpStatus: 400,
        durationMs: Date.now() - started,
        outcome: "SERVICE_SELECTION_REQUIRED",
      });
      return serviceSelectionResponse();
    }

    const selected = buildServiceSelectedResponse(raw);
    auditA2mcp({
      at: new Date().toISOString(),
      route: ROUTE,
      client_key: key,
      http_status: selected.http_status,
      outcome: String(selected.body.status),
      duration_ms: Date.now() - started,
    });
    logA2mcpRequest({
      route: ROUTE,
      method: "POST",
      contentType,
      contentLength,
      body: raw,
      recognisedAction: SELECT_SERVICE_ACTION,
      httpStatus: selected.http_status,
      durationMs: Date.now() - started,
      outcome: String(selected.body.status),
    });
    return NextResponse.json(selected.body, { status: selected.http_status });
  }

  // Generic Agent-5541 first contact: both services, require service_id.
  // Never assume 35958, never require payment, never ask user to describe Nobu.
  if (isFirstContactRequest(raw)) {
    auditA2mcp({
      at: new Date().toISOString(),
      route: ROUTE,
      client_key: key,
      http_status: 400,
      outcome: "SERVICE_SELECTION_REQUIRED",
      duration_ms: Date.now() - started,
    });
    logA2mcpRequest({
      route: ROUTE,
      method: "POST",
      contentType,
      contentLength,
      body: raw,
      recognisedAction: DESCRIBE_SERVICES_ACTION,
      httpStatus: 400,
      durationMs: Date.now() - started,
      outcome: "SERVICE_SELECTION_REQUIRED",
    });
    return serviceSelectionResponse();
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
