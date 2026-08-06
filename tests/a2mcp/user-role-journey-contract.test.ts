/**
 * Focused proof cases for the OKX User-role marketplace journey repair.
 * Covers catalogue, selection, paid 402, balance guidance, handoff, stages.
 */
import { describe, expect, it } from "vitest";
import { GET, POST as freePost } from "../../app/v1/agent/route.js";
import {
  buildPaidPrePaymentMachineFields,
  buildServiceSelectedResponse,
  buildServiceSelectionRequired,
  DEFAULT_FREE_SERVICE_ENDPOINT,
  DEFAULT_PAID_SERVICE_ENDPOINT,
  listAvailableServices,
} from "../../src/a2mcp/service-catalogue.js";
import { marketplaceIncompleteContract } from "../../src/a2mcp/conversation-contract.js";
import {
  monitoringPassForAgent,
  monitoringPassResponseBody,
} from "../../src/payments/monitoring-pass-service.js";
import {
  encodeX402ChallengeHeader,
  X402_VERSION,
} from "../../src/payments/x402.js";

async function json(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

describe("User-role journey contract proof", () => {
  // 1 + 13: generic Agent request catalogue and exact registered endpoints
  it("1/13 generic catalogue lists both services with exact registered endpoints", () => {
    const [free, paid] = listAvailableServices();
    expect(free.service_id).toBe(33561);
    expect(free.endpoint).toBe(DEFAULT_FREE_SERVICE_ENDPOINT);
    expect(free.endpoint).toBe("https://www.usenobu.xyz/v1/agent");
    expect(paid.service_id).toBe(35958);
    expect(paid.endpoint).toBe(DEFAULT_PAID_SERVICE_ENDPOINT);
    expect(paid.endpoint).toBe(
      "https://www.usenobu.xyz/v1/agent/monitoring-pass",
    );
    // Sole Production domain; free and paid use distinct paths.
    expect(new URL(free.endpoint).host).toBe("www.usenobu.xyz");
    expect(new URL(paid.endpoint).host).toBe("www.usenobu.xyz");
    expect(new URL(free.endpoint).pathname).not.toBe(
      new URL(paid.endpoint).pathname,
    );

    const sel = buildServiceSelectionRequired();
    expect(sel.status).toBe("SERVICE_SELECTION_REQUIRED");
    expect(sel.agent_id).toBe(5541);
    expect(sel.available_services.map((s) => s.service_id)).toEqual([
      33561, 35958,
    ]);
    expect(sel.payment_status).toBe("not_required");
    expect(sel.fields).toEqual(["service_id"]);
  });

  // 2: fresh conversation does not assume paid service
  it("2 fresh conversation does not assume paid service", async () => {
    const res = await freePost(
      new Request("http://localhost/v1/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: "I would like to use the service of agent 5541",
        }),
      }),
    );
    const body = await json(res);
    expect(res.status).toBe(400);
    expect(body.status).toBe("SERVICE_SELECTION_REQUIRED");
    expect(body.payment_status).toBe("not_required");
    expect(body.selected_service_id).toBeUndefined();
    expect(String(body.guidance)).toMatch(/Do not inspect payment balance/i);
    expect(String(body.guidance)).toMatch(/Never ask the user to describe Nobu/i);
  });

  // 3: prior paid context + new generic request requires fresh selection
  it("3 prior paid context plus new generic request requires fresh selection", async () => {
    // Simulate prior paid context in the same agent conversation by first
    // selecting paid, then a new generic Agent-only envelope.
    const paidSel = await freePost(
      new Request("http://localhost/v1/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "SELECT_SERVICE", service_id: 35958 }),
      }),
    );
    expect((await json(paidSel)).selected_service_id).toBe(35958);

    const generic = await freePost(
      new Request("http://localhost/v1/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: "I would like to use the service of agent 5541",
        }),
      }),
    );
    const body = await json(generic);
    expect(body.status).toBe("SERVICE_SELECTION_REQUIRED");
    expect(body.payment_status).toBe("not_required");
    expect(body.selected_service_id).toBeUndefined();
    expect(body.available_services).toHaveLength(2);
    expect(String(body.guidance)).toMatch(
      /Do not reuse an earlier service choice/i,
    );
  });

  // 4: explicit free-service choice
  it("4 explicit free-service choice", () => {
    const result = buildServiceSelectedResponse({
      action: "SELECT_SERVICE",
      service_id: 33561,
    });
    expect(result.http_status).toBe(200);
    if (result.body.status !== "SERVICE_SELECTED") throw new Error("bad status");
    expect(result.body.selected_service_id).toBe(33561);
    expect(result.body.payment_status).toBe("not_required");
    expect(result.body.input_required).toBe(false);
  });

  // 5: explicit Monitoring Pass choice
  it("5 explicit Monitoring Pass choice", () => {
    const result = buildServiceSelectedResponse({
      action: "SELECT_SERVICE",
      service_id: 35958,
    });
    expect(result.http_status).toBe(200);
    if (result.body.status !== "SERVICE_SELECTED") throw new Error("bad status");
    expect(result.body.selected_service_id).toBe(35958);
    expect(result.body.payment_status).toBe("required");
    if (!("deliverable" in result.body)) throw new Error("missing deliverable");
    expect(result.body.deliverable).toEqual({
      type: "monitoring_pass",
      quantity: 1,
    });
    expect(result.body.input_required).toBe(false);
    expect(result.body.fields).toEqual([]);
  });

  // 6 + 7 + 8 + 14: paid 402 shape, no business input, balance guidance, x402 valid
  it("6/7/8/14 paid 402 has no required business input and preserves one-quote balance guidance", async () => {
    const result = await monitoringPassForAgent({
      paymentAuthorizationHeader: null,
      resource: DEFAULT_PAID_SERVICE_ENDPOINT,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.http_status).toBe(402);
    expect(result.challenge.x402Version).toBe(X402_VERSION);
    expect(result.challenge.x402Version).toBe(2);
    expect(result.challenge.resource.url).toBe(DEFAULT_PAID_SERVICE_ENDPOINT);
    expect(result.challenge.accepts[0]?.amount).toBe("990000");
    expect(result.challenge.accepts[0]?.network).toBe("eip155:196");

    // Header is official base64 of the challenge (x402-check compatible).
    const header = encodeX402ChallengeHeader(result.challenge);
    expect(header).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(JSON.parse(Buffer.from(header, "base64").toString("utf8"))).toEqual(
      result.challenge,
    );

    const body = monitoringPassResponseBody(result);
    expect(body.status).toBe("PAYMENT_PENDING");
    // Neutral typed facts only — no imperative agent-control prose.
    expect(body.business_input_required).toBe(false);
    expect(body.required_fields).toEqual([]);
    expect(body.fields).toEqual([]);
    expect(body.requiredArgs).toEqual([]);
    expect(body.product_details_required_before_payment).toBe(false);
    expect(body.email_required_before_payment).toBe(false);
    expect(body.alert_threshold_required).toBe(false);
    expect(body.wallet_address_required_as_service_input).toBe(false);
    expect(body.replay_header_name).toBe("PAYMENT-SIGNATURE");
    expect(body.amount).toBe("990000");
    expect(body.monitoring_active).toBe(false);
    expect(body.never_ask_user_for).toBeUndefined();
    expect(body.guidance).toBeUndefined();

    // Body must not suggest collecting wallet/threshold/email/product as service params.
    const blob = JSON.stringify(body);
    expect(blob).not.toMatch(/required_fields":\["wallet/i);
    expect(blob).not.toMatch(/please provide your wallet/i);

    // Catalogue machine fields agree.
    const m = buildPaidPrePaymentMachineFields();
    expect(m.selected_service_id).toBe(35958);
    expect(m.deliverable).toEqual({ type: "monitoring_pass", quantity: 1 });
  });

  // 9: issued pass continues to 33561 without second payment
  it("9 issued pass response continues to service 33561 without second payment", async () => {
    // Synthetic issued body shape (route uses marketplace journey for full path).
    const body = monitoringPassResponseBody({
      ok: true,
      status: "MONITORING_PASS_ISSUED",
      http_status: 200,
      pass: {
        id: "pass_testissued0001",
        pass_token_hash: "hash",
        settlement_ref: "settle_test",
        payment_id: "pay_test",
        price_amount: 0.99,
        price_currency: "USD",
        status: "issued",
        redeemed_at: null,
        redeemed_quote_id: null,
        redeemed_purchase_id: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      pass_continuation_id: "pass_cont_testissued0001",
      journey_id: "journey_testissued0001",
      journey_stage: "confirm_use_pass",
      settlementRef: "settle_test",
      payment_response_header: "dGVzdA==",
    });
    expect(body.status).toBe("MONITORING_PASS_ISSUED");
    expect(body.payment_status).toBe("recognized");
    expect(body.second_payment_required).toBe(false);
    expect(body.input_required).toBe(true);
    expect(body.required_fields).toEqual(["confirm_use_pass"]);
    expect(JSON.stringify(body)).not.toMatch(/pass_claim_credential|claim_credential/);
    expect(body.monitoring_active).toBe(false);
    expect(body.journey_complete).toBe(false);
    expect(body.next_service_id).toBe(33561);
    expect(body.next_service_endpoint).toBeTruthy();
  });

  // 10 + 11: each setup stage correct input contract; automatic stages no user IDs
  it("10/11 each setup stage exposes the correct input contract", () => {
    const human: Array<{
      stage:
        | "confirm_use_pass"
        | "purchase_description"
        | "candidate_id"
        | "email"
        | "verification_code"
        | "consents";
      fields: string[];
      next: string;
    }> = [
      {
        stage: "confirm_use_pass",
        fields: ["confirm_use_pass"],
        next: "CONFIRM_USE_PASS",
      },
      {
        stage: "purchase_description",
        fields: ["purchase_description"],
        next: "PROVIDE_PURCHASE_DESCRIPTION",
      },
      {
        stage: "candidate_id",
        fields: ["candidate_id"],
        next: "SELECT_CANDIDATE",
      },
      { stage: "email", fields: ["email"], next: "PROVIDE_EMAIL" },
      {
        stage: "verification_code",
        fields: ["verification_code"],
        next: "PROVIDE_VERIFICATION_CODE",
      },
      {
        stage: "consents",
        fields: ["monitoring_consent", "email_alert_consent"],
        next: "PROVIDE_CONSENTS",
      },
    ];

    for (const h of human) {
      const body = marketplaceIncompleteContract({
        stage: h.stage,
        journeyId: "journey_stageproof",
      });
      expect(body.input_required).toBe(true);
      expect(body.automatic_continue).toBe(false);
      expect(body.fields).toEqual(h.fields);
      expect(body.required_fields).toEqual(h.fields);
      expect(body.next_action).toBe(h.next);
      expect(body.current_step).toBe(h.stage);
      expect(body.monitoring_active).toBe(false);
      expect(body.journey_complete).toBe(false);
      expect(body.payment_status).toBe("recognized");
      expect(body.second_payment_required).toBe(false);
      expect(body.journey_id).toBe("journey_stageproof");
      // Never require the user to type journey_id.
      expect(h.fields).not.toContain("journey_id");
      // Email/consent only at their stages.
      if (h.stage !== "email") expect(h.fields).not.toContain("email");
      if (h.stage !== "consents") {
        expect(h.fields).not.toContain("monitoring_consent");
      }
    }

    const auto = marketplaceIncompleteContract({
      stage: "product_discovery",
      journeyId: "journey_stageproof",
    });
    expect(auto.input_required).toBe(false);
    expect(auto.automatic_continue).toBe(true);
    expect(auto.fields).toEqual([]);
    expect(auto.required_user_input).toBeNull();
    expect(auto.protocol_continuation?.user_input_fields).toEqual([]);
    expect(auto.machine_continuation).toEqual(auto.protocol_continuation);
    expect(auto.guidance).toBeUndefined();
  });

  // 12: monitoring active only after successful redemption is covered by
  // marketplace-journey happy path; contract-level lock:
  it("12 MONITORING_ACTIVE flags only on redemption complete contract shape", () => {
    // Human stages never mark monitoring active.
    for (const stage of [
      "confirm_use_pass",
      "purchase_description",
      "product_discovery",
      "candidate_id",
      "email",
      "verification_code",
      "consents",
    ] as const) {
      const body = marketplaceIncompleteContract({
        stage,
        journeyId: "journey_x",
      });
      expect(body.monitoring_active).toBe(false);
      expect(body.journey_complete).toBe(false);
      expect(body.status).not.toBe("MONITORING_ACTIVE");
    }
  });

  it("GET free first contact matches SERVICE_SELECTION_REQUIRED", async () => {
    const res = await GET(new Request("http://localhost/v1/agent", { method: "GET" }));
    const body = await json(res);
    expect(res.status).toBe(400);
    expect(body.status).toBe("SERVICE_SELECTION_REQUIRED");
    expect(body.available_services).toHaveLength(2);
  });
});
