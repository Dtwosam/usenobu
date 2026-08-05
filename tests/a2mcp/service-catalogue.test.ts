import { describe, expect, it } from "vitest";
import {
  buildPaidCatalogueService,
  buildPaidPrePaymentMachineFields,
  buildServiceSelectedResponse,
  buildServiceSelectionRequired,
  buildFreeCatalogueService,
  DEFAULT_FREE_SERVICE_ENDPOINT,
  DEFAULT_PAID_SERVICE_ENDPOINT,
  FREE_SERVICE_ID,
  listAvailableServices,
  NOBU_AGENT_ID,
  NOBU_AGENT_NAME,
  PAID_SERVICE_ID,
  resolveFreeServiceEndpoint,
  resolvePaidServiceEndpoint,
} from "../../src/a2mcp/service-catalogue.js";

describe("canonical service catalogue", () => {
  it("locks agent and both services with distinct endpoints", () => {
    const [free, paid] = listAvailableServices();
    expect(NOBU_AGENT_ID).toBe(5541);
    expect(NOBU_AGENT_NAME).toBe("Nobu");
    expect(free.service_id).toBe(FREE_SERVICE_ID);
    expect(free.service_id).toBe(33561);
    expect(free.name).toBe("Nobu Purchase Setup");
    expect(free.price).toBe("free");
    expect(free.price_usdt).toBe(0);
    expect(free.endpoint).toBe(DEFAULT_FREE_SERVICE_ENDPOINT);
    expect(free.sells_monitoring_pass).toBe(false);
    expect(free.activates_monitoring).toBe(false);

    expect(paid.service_id).toBe(PAID_SERVICE_ID);
    expect(paid.service_id).toBe(35958);
    expect(paid.name).toBe("Nobu Monitoring Pass");
    expect(paid.price).toBe("0.99 USDT");
    expect(paid.price_usdt).toBe(0.99);
    expect(paid.endpoint).toBe(DEFAULT_PAID_SERVICE_ENDPOINT);
    expect(paid.endpoint).toBe("https://www.usenobu.xyz/v1/agent/monitoring-pass");
    expect(paid.sells_monitoring_pass).toBe(true);
    expect(paid.activates_monitoring).toBe(false);
    expect(paid.parameters_required_before_payment).toEqual([]);

    // Distinct hosts — never share one base URL.
    expect(new URL(free.endpoint).host).not.toBe(new URL(paid.endpoint).host);
  });

  it("resolves free and paid endpoints independently from env", () => {
    expect(
      resolveFreeServiceEndpoint({
        NOBU_FREE_SERVICE_ENDPOINT: "https://free.example/v1/agent",
        NOBU_PAID_SERVICE_ENDPOINT: "https://paid.example/v1/agent/monitoring-pass",
      }),
    ).toBe("https://free.example/v1/agent");
    expect(
      resolvePaidServiceEndpoint({
        NOBU_FREE_SERVICE_ENDPOINT: "https://free.example/v1/agent",
        NOBU_PAID_SERVICE_ENDPOINT: "https://paid.example/v1/agent/monitoring-pass",
      }),
    ).toBe("https://paid.example/v1/agent/monitoring-pass");
    expect(buildFreeCatalogueService({}).endpoint).toBe(
      DEFAULT_FREE_SERVICE_ENDPOINT,
    );
    expect(buildPaidCatalogueService({}).endpoint).toBe(
      DEFAULT_PAID_SERVICE_ENDPOINT,
    );
  });

  it("SERVICE_SELECTION_REQUIRED lists both services and requires service_id only", () => {
    const body = buildServiceSelectionRequired();
    expect(body.status).toBe("SERVICE_SELECTION_REQUIRED");
    expect(body.agent_id).toBe(5541);
    expect(body.agent_name).toBe("Nobu");
    expect(body.service_selection_required).toBe(true);
    expect(body.available_services).toHaveLength(2);
    expect(body.available_services.map((s) => s.service_id)).toEqual([
      33561, 35958,
    ]);
    expect(body.input_required).toBe(true);
    expect(body.required_fields).toEqual(["service_id"]);
    expect(body.fields).toEqual(["service_id"]);
    expect(body.requiredArgs).toEqual(["service_id"]);
    expect(body.payment_status).toBe("not_required");
    expect(body.monitoring_active).toBe(false);
    expect(body.journey_complete).toBe(false);
    expect(body.auto_invoke).toBe("DESCRIBE_SERVICES");
    expect(body.do_not_ask_user_for_internal_action).toBe(true);
    expect(body.guidance).toMatch(/Do not assume a service from Agent ID alone/i);
    expect(body.guidance).toMatch(/Never ask the user to describe Nobu/i);
    expect(body.guidance).toMatch(/Do not inspect payment balance/i);
  });

  it("SELECT_SERVICE free path never requires payment", () => {
    const result = buildServiceSelectedResponse({
      action: "SELECT_SERVICE",
      service_id: 33561,
    });
    expect(result.http_status).toBe(200);
    expect(result.body.status).toBe("SERVICE_SELECTED");
    if (result.body.status !== "SERVICE_SELECTED") throw new Error("unreachable");
    expect(result.body.selected_service_id).toBe(33561);
    expect(result.body.payment_status).toBe("not_required");
    expect(result.body.input_required).toBe(false);
    expect(result.body.fields).toEqual([]);
  });

  it("SELECT_SERVICE paid path requires no service parameters before payment", () => {
    const result = buildServiceSelectedResponse({
      action: "SELECT_SERVICE",
      service_id: 35958,
    });
    expect(result.http_status).toBe(200);
    expect(result.body.status).toBe("SERVICE_SELECTED");
    if (result.body.status !== "SERVICE_SELECTED") throw new Error("unreachable");
    expect(result.body.selected_service_id).toBe(35958);
    expect(result.body.payment_status).toBe("required");
    expect(result.body.input_required).toBe(false);
    expect(result.body.fields).toEqual([]);
    expect(result.body.requiredArgs).toEqual([]);
    if ("product_details_required_before_payment" in result.body) {
      expect(result.body.product_details_required_before_payment).toBe(false);
      expect(result.body.email_required_before_payment).toBe(false);
      expect(result.body.wallet_address_required_as_service_input).toBe(false);
      expect(result.body.deliverable).toEqual({
        type: "monitoring_pass",
        quantity: 1,
      });
    }
  });

  it("paid pre-payment machine fields match the locked contract", () => {
    const m = buildPaidPrePaymentMachineFields();
    expect(m.selected_service_id).toBe(35958);
    expect(m.selected_service_name).toBe("Nobu Monitoring Pass");
    expect(m.input_required).toBe(false);
    expect(m.required_fields).toEqual([]);
    expect(m.fields).toEqual([]);
    expect(m.requiredArgs).toEqual([]);
    expect(m.required_user_input).toBeNull();
    expect(m.product_details_required_before_payment).toBe(false);
    expect(m.email_required_before_payment).toBe(false);
    expect(m.alert_threshold_required).toBe(false);
    expect(m.wallet_address_required_as_service_input).toBe(false);
    expect(m.payment_status).toBe("required");
    expect(m.monitoring_active).toBe(false);
    expect(m.journey_complete).toBe(false);
    expect(m.next_service_id).toBe(33561);
    expect(m.next_action_after_payment).toBe("CONTINUE_PURCHASE_SETUP");
    expect(String(m.service_description)).toMatch(
      /No product details, email, wallet address, alert threshold/i,
    );
    expect(String(m.service_description)).toMatch(
      /does not activate monitoring/i,
    );
  });
});
