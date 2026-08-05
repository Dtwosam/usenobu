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
} from "@/payments/x402";
import { resolvePaidServiceEndpoint } from "@/a2mcp/service-catalogue";

/**
 * Lane 8R.3B — paid A2MCP service `35958`, "Nobu Monitoring Pass" ($0.99).
 *
 * Every initial call — GET or POST, body or no body — returns HTTP 402 with
 * the base64 x402 v2 challenge in the PAYMENT-REQUIRED header, before any
 * business execution and without requiring a quote, connection, purchase or
 * consent. The signed replay travels in PAYMENT-SIGNATURE (never the body)
 * and returns the issued Monitoring Pass.
 *
 * Registered paid endpoint (distinct from free service host):
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

/**
 * x402 resource.url must match the registered paid endpoint.
 * Uses NOBU_PAID_SERVICE_ENDPOINT or the catalogue default — never derived
 * from the free-service host.
 */
function resolveResourceUrl(env: NodeJS.ProcessEnv = process.env): string {
  return resolvePaidServiceEndpoint(env);
}

async function handle(req: Request, method: "GET" | "POST") {
  const started = Date.now();
  const key = clientKey(req);
  const contentType = req.headers.get("content-type");
  const contentLength = parseContentLength(req.headers.get("content-length"));
  const paymentAuthorizationHeader = req.headers.get(X402_PAYMENT_HEADER_NAME);

  // Existing-pass and post-issuance journey calls are free even on this URL.
  // Read only the JSON body; structured logging below records key names, not values.
  let raw: unknown = null;
  if (method === "POST") {
    try {
      const bodyText = await req.text();
      raw = bodyText.trim() ? JSON.parse(bodyText) : null;
    } catch {
      raw = null;
    }
  }
  if (isMarketplaceJourneyRequest(raw)) {
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

  // Rate limiting applies only to the paid replay path. An unpaid first
  // contact must always receive its challenge — that is what OKX's validator
  // and every first-time caller probe with.
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
    // Payment material stays in its header and is never logged.
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

  if (result.status === "MONITORING_PASS_ISSUED") {
    const journey = await runMarketplaceJourney({
      monitoring_pass_id: result.pass.id,
    });
    // Official Onchain OS 4.4.0 handles a non-2xx replay carrying
    // status=input_required by collecting the returned fields. A 200 replay
    // is terminalized before that branch, so keep this truthful continuation
    // non-terminal after the already-settled, exactly-once pass issuance.
    return NextResponse.json(journey.body, { status: journey.http_status });
  }

  return NextResponse.json(monitoringPassResponseBody(result), {
    status: result.http_status,
  });
}

export async function GET(req: Request) {
  return handle(req, "GET");
}

export async function POST(req: Request) {
  return handle(req, "POST");
}
