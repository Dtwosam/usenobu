import { describe, expect, it } from "vitest";

import { GET, POST } from "../../app/v1/agent/route.js";

async function responseBody(
  response: Response,
): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

function expectInputRequired(body: Record<string, unknown>): void {
  expect(body.status).toBe("input_required");
  expect(body.introduction).toMatch(/Nobu monitors exact Target online purchases/i);
  expect(body.message).toMatch(/free/i);
  expect(body.message).toMatch(/0\.99|35958|pass/i);
  expect(body.completed_step).toBe("NOBU_INTRODUCED");
  expect(body.payment_status).toBe("required");
  expect(body.second_payment_required).toBe(false);
  expect(body.retry_safe).toBe(true);
  expect(body.monitoring_active).toBe(false);
  expect(body.journey_complete).toBe(false);
  expect(body.next_action).toMatch(/35958|pass|UNDERSTAND_PURCHASE|RESOLVE/i);
  expect(body.required_user_input).toEqual(
    expect.objectContaining({ action: "UNDERSTAND_PURCHASE" }),
  );
  expect(body.guidance).toMatch(/one deliberate payment quote|balance_unavailable|33561/i);
  expect(body.fields).toEqual(["action"]);
  expect(body.requiredArgs).toEqual(["action"]);
  expect(body.supported_actions).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        action: "UNDERSTAND_PURCHASE",
        required_fields: ["action", "purchase_text"],
      }),
    ]),
  );
}

describe("free /v1/agent validation probes", () => {
  it("returns 400 input_required for an empty GET probe", async () => {
    const response = await GET(
      new Request("http://localhost/v1/agent", { method: "GET" }),
    );

    expect(response.status).toBe(400);
    expectInputRequired(await responseBody(response));
  });

  it.each([
    ["bodyless POST", undefined],
    ["empty object POST", "{}"],
  ])("returns 400 input_required for %s", async (_label, body) => {
    const response = await POST(
      new Request("http://localhost/v1/agent", {
        method: "POST",
        headers: body ? { "content-type": "application/json" } : undefined,
        body,
      }),
    );

    expect(response.status).toBe(400);
    expectInputRequired(await responseBody(response));
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
    expect(body.status).not.toBe("input_required");
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
    expect(body.status).not.toBe("input_required");
    expect(body.completed_step).toBe("PURCHASE_DETAILS_EXTRACTED");
    expect(body.monitoring_active).toBe(false);
    expect(body.journey_complete).toBe(false);
    expect(body.next_action).toBe("DISCOVER_PRODUCT");
    expect(body.required_user_input).toEqual(expect.objectContaining({ action: "DISCOVER_PRODUCT" }));
    expect(body.guidance).toMatch(/Monitoring is not active/);
  });
});
