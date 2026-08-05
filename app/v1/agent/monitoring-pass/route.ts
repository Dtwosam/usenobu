import { NextResponse } from "next/server";
import { auditA2mcp, defaultA2mcpRateLimiter } from "@/a2mcp/index";
import { logA2mcpRequest, parseContentLength } from "@/a2mcp/request-log";
import {
  isMarketplaceJourneyRequest,
  runMarketplaceJourney,
} from "@/a2mcp/marketplace-journey";
import {
  monitoringPassForAgent,
  monitoringPassResponseBody,
} from "@/payments/monitoring-pass-service";
import {
  X402_CHALLENGE_HEADER_NAME,
  X402_PAYMENT_HEADER_NAME,
  X402_PAYMENT_RESPONSE_HEADER_NAME,
} from "@/payments/x402";
import { resolvePaidServiceEndpoint } from "@/a2mcp/service-catalogue";

/**
 * Paid A2MCP service `35958`, "Nobu Monitoring Pass" ($0.99).
 *
 * Unpaid contact → HTTP 402 + PAYMENT-REQUIRED.
 * Successful settlement → HTTP 200 + PAYMENT-RESPONSE + MONITORING_PASS_ISSUED.
 * Never issues a pass before confirmed settlement. Never returns a fresh 402
 * or human-input 400 after successful settlement.
 *
 * Registered paid endpoint:
 * https://www.usenobu.xyz/v1/agent/monitoring-pass
 */

const ROUTE = "/v1/agent/monitoring-pass";

function clientKey(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]?.trim() || "unknown";
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return "local";
}

function resolveResourceUrl(env: NodeJS.ProcessEnv = process.env): string {
  return resolvePaidServiceEndpoint(env);
}

async function handle(req: Request, method: "GET" | "POST") {
  const started = Date.now();
  const key = clientKey(req);
  const contentType = req.headers.get("content-type");
  const contentLength = parseContentLength(req.headers.get("content-length"));
  const paymentAuthorizationHeader = req.headers.get(X402_PAYMENT_HEADER_NAME);

  let raw: unknown = null;
  if (method === "POST") {
    try {
      const bodyText = await req.text();
      raw = bodyText.trim() ? JSON.parse(bodyText) : null;
    } catch {
      raw = null;
    }
  }

  // Post-issuance free journey on this URL only when no payment replay is present.
  // Never run journey (and never return 400 input_required) after a settled payment.
  if (!paymentAuthorizationHeader && isMarketplaceJourneyRequest(raw)) {
    const journey = await runMarketplaceJourney(raw, { sourceKey: key });
    auditA2mcp({
      at: new Date().toISOString(),
      route: ROUTE,
      client_key: key,
      http_status: journey.http_status,
      outcome: String(journey.body.status || "marketplace_journey"),
      duration_ms: Date.now() - started,
    });
    logA2mcpRequest({
      route: ROUTE,
      method,
      contentType,
      contentLength,
      body: raw,
      recognisedAction: null,
      httpStatus: journey.http_status,
      durationMs: Date.now() - started,
      outcome: String(journey.body.status || "marketplace_journey"),
      clientDisconnected: req.signal?.aborted ?? false,
    });
    return NextResponse.json(journey.body, { status: journey.http_status });
  }

  if (paymentAuthorizationHeader) {
    const limit = defaultA2mcpRateLimiter.check(key);
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
        method,
        contentType,
        contentLength,
        body: null,
        recognisedAction: "MONITORING_PASS",
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
  }

  const result = await monitoringPassForAgent({
    paymentAuthorizationHeader,
    resource: resolveResourceUrl(),
  });

  auditA2mcp({
    at: new Date().toISOString(),
    route: ROUTE,
    client_key: key,
    http_status: result.http_status,
    outcome: result.status,
    duration_ms: Date.now() - started,
  });
  logA2mcpRequest({
    route: ROUTE,
    method,
    contentType,
    contentLength,
    body: raw,
    recognisedAction: "MONITORING_PASS",
    httpStatus: result.http_status,
    durationMs: Date.now() - started,
    outcome: result.status,
    clientDisconnected: req.signal?.aborted ?? false,
  });

  if (!result.ok) {
    return NextResponse.json(monitoringPassResponseBody(result), {
      status: 402,
      headers: { [X402_CHALLENGE_HEADER_NAME]: result.challengeHeaderValue },
    });
  }

  // Successful settlement path: always HTTP 200 with official receipt when available.
  // Never return 400 human-input after confirmed settlement.
  const headers: Record<string, string> = {};
  if (
    "payment_response_header" in result &&
    result.payment_response_header
  ) {
    headers[X402_PAYMENT_RESPONSE_HEADER_NAME] = result.payment_response_header;
  }

  return NextResponse.json(monitoringPassResponseBody(result), {
    status: 200,
    headers,
  });
}

export async function GET(req: Request) {
  return handle(req, "GET");
}

export async function POST(req: Request) {
  return handle(req, "POST");
}
