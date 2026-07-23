/**
 * Lane 8R.3 — focused contract tests for the paid /v1/agent/start-monitoring
 * route's opaque-error repair. Root cause: OKX rejected ASP #5541 because
 * actual service-call results did not match the registered service
 * description; reproduction against production showed the paid endpoint
 * returning bare `{"error":"invalid_input"}` / `{"status":"ACTION_NOT_AUTHORIZED"}`
 * with no guidance for the most likely first reviewer call (calling the paid
 * endpoint before completing the free setup flow). These tests cover only
 * the added guidance fields — not the underlying auth/payment gates, which
 * are unchanged (see tests/payments/start-monitoring.test.ts).
 */
import { describe, expect, it } from "vitest";
import { POST } from "../../app/v1/agent/start-monitoring/route.js";
import { startMonitoringResponseBody as responseBody } from "../../src/payments/start-monitoring-response.js";
import type { StartMonitoringResult } from "../../src/payments/start-monitoring-service.js";

function request(body: unknown): Request {
  return new Request("https://usenobu.vercel.app/v1/agent/start-monitoring", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("start-monitoring route — schema-violation guidance (Lane 8R.3)", () => {
  it("empty body still 400s, but now names required fields, next action, and docs", async () => {
    const res = await POST(request({}));
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("invalid_input");
    expect(body.required_fields).toEqual(["quote_id", "connection_id", "connection_token"]);
    expect(typeof body.next_action).toBe("string");
    expect(body.next_action as string).toContain("PREFLIGHT_MONITORING");
    expect(body.documentation).toBe("https://usenobu.vercel.app/okx");
  });

  it("a plausible natural-language body still 400s with the same machine-readable guidance", async () => {
    const res = await POST(request({ message: "activate monitoring for my Target purchase" }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("invalid_input");
    expect(body.required_fields).toEqual(["quote_id", "connection_id", "connection_token"]);
  });

  it("fabricated-but-well-shaped credentials never bypass validation (schema alone is not authorization)", async () => {
    const res = await POST(
      request({ quote_id: "quote_x", connection_id: "conn_x", connection_token: "tok_x" }),
    );
    // Passes schema (well-shaped) so it reaches the auth/quote gate — asserted separately below.
    expect([400, 401, 404]).toContain(res.status);
  });
});

describe("responseBody — ACTION_NOT_AUTHORIZED / CONNECTION_EXPIRED guidance (Lane 8R.3)", () => {
  it("adds reason-agnostic message/next_action/documentation without changing status or agent_state", () => {
    const result: StartMonitoringResult = {
      ok: false,
      status: "ACTION_NOT_AUTHORIZED",
      http_status: 401,
    };
    const body = responseBody(result);
    expect(body.agent_state).toBe("MONITORING_ACTIVATION");
    expect(body.status).toBe("ACTION_NOT_AUTHORIZED");
    expect(typeof body.message).toBe("string");
    expect(body.next_action).toContain("PREFLIGHT_MONITORING");
    expect(body.documentation).toBe("https://usenobu.vercel.app/okx");
  });

  it("CONNECTION_EXPIRED gets the identical guidance fields as ACTION_NOT_AUTHORIZED (no reason leaked)", () => {
    const authResult = responseBody({ ok: false, status: "ACTION_NOT_AUTHORIZED", http_status: 401 });
    const expiredResult = responseBody({ ok: false, status: "CONNECTION_EXPIRED", http_status: 404 });
    expect(authResult.message).toBe(expiredResult.message);
    expect(authResult.next_action).toBe(expiredResult.next_action);
    expect(authResult.documentation).toBe(expiredResult.documentation);
  });

  it("success shapes are unchanged by the guidance addition", () => {
    const started = responseBody({
      ok: true,
      status: "MONITORING_STARTED",
      monitor_id: "purchase_1",
      monitoring_deadline: "2026-08-01T00:00:00.000Z",
      http_status: 200,
    });
    expect(started).toEqual({
      agent_state: "MONITORING_ACTIVATION",
      status: "MONITORING_STARTED",
      monitor_id: "purchase_1",
      monitoring_deadline: "2026-08-01T00:00:00.000Z",
    });

    const pending = responseBody({
      ok: true,
      status: "PAYMENT_SETTLEMENT_PENDING",
      http_status: 200,
      note: "settlement submitted",
    });
    expect(pending).toEqual({
      agent_state: "MONITORING_ACTIVATION",
      status: "PAYMENT_SETTLEMENT_PENDING",
      note: "settlement submitted",
    });
  });

  it("PAYMENT_PENDING (the 402 challenge) is untouched by this route's guidance branch", () => {
    // The 402 challenge is handled by a separate return path in POST (carries
    // its own well-formed x402 payload); responseBody's guidance branch only
    // ever fires for ACTION_NOT_AUTHORIZED / CONNECTION_EXPIRED.
    const body = responseBody({
      ok: false,
      status: "PAYMENT_PENDING",
      challenge: {
        x402Version: 2,
        resource: "https://usenobu.vercel.app/v1/agent/start-monitoring",
        accepts: [],
      },
      challengeHeaderValue: "redacted",
      http_status: 402,
    });
    expect(body).toEqual({ agent_state: "MONITORING_ACTIVATION", status: "PAYMENT_PENDING" });
  });
});
