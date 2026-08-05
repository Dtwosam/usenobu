import { describe, expect, it } from "vitest";

import { GET, POST } from "../../app/v1/agent/route.js";
import {
  DEFAULT_FREE_SERVICE_ENDPOINT,
  DEFAULT_PAID_SERVICE_ENDPOINT,
  FREE_SERVICE_ID,
  PAID_SERVICE_ID,
} from "../../src/a2mcp/service-catalogue.js";

async function responseBody(
  response: Response,
): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

function expectServiceSelection(body: Record<string, unknown>): void {
  expect(body.status).toBe("SERVICE_SELECTION_REQUIRED");
  expect(body.agent_id).toBe(5541);
  expect(body.agent_name).toBe("Nobu");
  expect(body.service_selection_required).toBe(true);
  expect(body.input_required).toBe(true);
  expect(body.required_fields).toEqual(["service_id"]);
  expect(body.fields).toEqual(["service_id"]);
  expect(body.requiredArgs).toEqual(["service_id"]);
  expect(body.payment_status).toBe("not_required");
  expect(body.monitoring_active).toBe(false);
  expect(body.journey_complete).toBe(false);
  expect(body.second_payment_required).toBe(false);
  expect(body.auto_invoke).toBe("DESCRIBE_SERVICES");
  expect(body.do_not_ask_user_for_internal_action).toBe(true);
  expect(String(body.guidance)).toMatch(/Do not assume a service from Agent ID alone/i);
  expect(String(body.guidance)).toMatch(/Never ask the user to describe Nobu/i);
  expect(String(body.guidance)).toMatch(/Do not inspect payment balance/i);

  const services = body.available_services as Array<Record<string, unknown>>;
  expect(services).toHaveLength(2);
  expect(services[0]).toEqual(
    expect.objectContaining({
      service_id: FREE_SERVICE_ID,
      name: "Nobu Purchase Setup",
      price: "free",
      endpoint: DEFAULT_FREE_SERVICE_ENDPOINT,
    }),
  );
  expect(services[1]).toEqual(
    expect.objectContaining({
      service_id: PAID_SERVICE_ID,
      name: "Nobu Monitoring Pass",
      price: "0.99 USDT",
      endpoint: DEFAULT_PAID_SERVICE_ENDPOINT,
    }),
  );
}

describe("free /v1/agent validation probes", () => {
  it("returns SERVICE_SELECTION_REQUIRED for an empty GET probe", async () => {
    const response = await GET(
      new Request("http://localhost/v1/agent", { method: "GET" }),
    );

    expect(response.status).toBe(400);
    expectServiceSelection(await responseBody(response));
  });

  it.each([
    ["bodyless POST", undefined],
    ["empty object POST", "{}"],
    [
      "generic agent-only envelope",
      JSON.stringify({ message: "I would like to use the service of agent 5541" }),
    ],
  ])("returns SERVICE_SELECTION_REQUIRED for %s", async (_label, body) => {
    const response = await POST(
      new Request("http://localhost/v1/agent", {
        method: "POST",
        headers: body ? { "content-type": "application/json" } : undefined,
        body,
      }),
    );

    expect(response.status).toBe(400);
    expectServiceSelection(await responseBody(response));
  });

  it("DESCRIBE_SERVICES returns the same catalogue selection contract", async () => {
    const response = await POST(
      new Request("http://localhost/v1/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "DESCRIBE_SERVICES" }),
      }),
    );
    expect(response.status).toBe(400);
    expectServiceSelection(await responseBody(response));
  });

  it("SELECT_SERVICE 33561 selects free Purchase Setup without payment", async () => {
    const response = await POST(
      new Request("http://localhost/v1/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "SELECT_SERVICE", service_id: 33561 }),
      }),
    );
    const body = await responseBody(response);
    expect(response.status).toBe(200);
    expect(body.status).toBe("SERVICE_SELECTED");
    expect(body.selected_service_id).toBe(33561);
    expect(body.payment_status).toBe("not_required");
    expect(body.input_required).toBe(false);
  });

  it("SELECT_SERVICE 35958 points at paid pass with no pre-payment parameters", async () => {
    const response = await POST(
      new Request("http://localhost/v1/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "SELECT_SERVICE", service_id: 35958 }),
      }),
    );
    const body = await responseBody(response);
    expect(response.status).toBe(200);
    expect(body.status).toBe("SERVICE_SELECTED");
    expect(body.selected_service_id).toBe(35958);
    expect(body.payment_status).toBe("required");
    expect(body.input_required).toBe(false);
    expect(body.fields).toEqual([]);
    expect(body.requiredArgs).toEqual([]);
    expect(body.product_details_required_before_payment).toBe(false);
    expect(body.paid_endpoint).toBe(DEFAULT_PAID_SERVICE_ENDPOINT);
  });

  it("keeps a supported action on the existing dispatcher path", async () => {
    const response = await POST(
      new Request("http://localhost/v1/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "UNDERSTAND_PURCHASE" }),
      }),
    );
    const body = await responseBody(response);

    expect(response.status).toBe(400);
    expect(body.status).not.toBe("SERVICE_SELECTION_REQUIRED");
    expect(body.error).toBe("invalid_input");
  });

  it("preserves a valid UNDERSTAND_PURCHASE response", async () => {
    const response = await POST(
      new Request("http://localhost/v1/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "UNDERSTAND_PURCHASE",
          purchase_text:
            "I bought an Apple AirTag from Target online on 2026-07-20 for $29.99",
        }),
      }),
    );
    const body = await responseBody(response);

    expect(response.status).toBe(200);
    expect(body.agent_state).toBe("CONFIRMATION_REQUIRED");
    expect(body.status).not.toBe("SERVICE_SELECTION_REQUIRED");
    expect(body.completed_step).toBe("PURCHASE_DETAILS_EXTRACTED");
    expect(body.monitoring_active).toBe(false);
    expect(body.journey_complete).toBe(false);
    expect(body.next_action).toBe("DISCOVER_PRODUCT");
    expect(body.required_user_input).toEqual(
      expect.objectContaining({ action: "DISCOVER_PRODUCT" }),
    );
    expect(body.guidance).toMatch(/Monitoring is not active/);
  });
});
