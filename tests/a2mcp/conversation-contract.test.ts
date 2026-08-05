import { describe, expect, it } from "vitest";
import {
  buildConversationContract,
  marketplaceIncompleteContract,
} from "../../src/a2mcp/conversation-contract.js";
import { marketplaceFirstContact } from "../../src/a2mcp/marketplace-journey.js";

describe("conversation contract", () => {
  it("always includes payment clarity and retry safety", () => {
    const c = buildConversationContract({
      status: "PAYMENT_SETTLEMENT_PENDING",
      completed_step: "PAYMENT_SUBMITTED",
      next_action: "RESOLVE_MONITORING_PASS",
      message: "Wait for confirmation.",
      guidance: "Do not pay again.",
      payment_status: "pending",
      required_fields: ["pass_continuation_id"],
      pass_continuation_id: "pass_cont_abc",
    });
    expect(c.second_payment_required).toBe(false);
    expect(c.payment_status).toBe("pending");
    expect(c.retry_safe).toBe(true);
    expect(c.monitoring_active).toBe(false);
    // next_action alone must not invent a user-facing action field.
    expect(c.fields).toEqual(["pass_continuation_id"]);
    expect(c.requiredArgs).toEqual(c.fields);
    expect(c.pass_continuation_id).toBe("pass_cont_abc");
  });

  it("only prepends protocol action when include_action_field is true", () => {
    const withAction = buildConversationContract({
      status: "input_required",
      completed_step: "TEST",
      next_action: "UNDERSTAND_PURCHASE",
      message: "Need purchase text",
      guidance: "Collect purchase_text",
      payment_status: "not_required",
      required_fields: ["purchase_text"],
      include_action_field: true,
    });
    expect(withAction.fields).toEqual(["action", "purchase_text"]);

    const noAction = buildConversationContract({
      status: "PAYMENT_PENDING",
      completed_step: "MONITORING_PASS_EXPLAINED",
      next_action: "COMPLETE_X402_PAYMENT",
      message: "Pay once",
      guidance: "No service params",
      payment_status: "required",
      required_fields: [],
      required_user_input: null,
      input_required: false,
    });
    expect(noAction.fields).toEqual([]);
    expect(noAction.requiredArgs).toEqual([]);
    expect(noAction.required_user_input).toBeNull();
    expect(noAction.input_required).toBe(false);
  });

  it("does not invent action fields from next_action alone", () => {
    const c = buildConversationContract({
      status: "READY",
      completed_step: "NOBU_INTRODUCED",
      next_action: "DESCRIBE_SERVICES",
      message: "Describe services",
      guidance: "Auto-invoke",
      payment_status: "not_required",
    });
    expect(c.fields).toBeNull();
    expect(c.requiredArgs).toBeNull();
  });

  it("marketplace human stages ask one focused user input without journey_id", () => {
    const body = marketplaceIncompleteContract({
      stage: "confirm_use_pass",
      journeyId: "journey_test",
      monitoringPassId: "pass_test",
    });
    expect(body.status).toBe("MONITORING_PASS_ISSUED");
    expect(body.next_action).toBe("CONFIRM_USE_PASS");
    expect(body.current_step).toBe("confirm_use_pass");
    expect(body.fields).toEqual(["confirm_use_pass"]);
    expect(body.required_fields).toEqual(["confirm_use_pass"]);
    expect(body.input_required).toBe(true);
    expect(body.automatic_continue).toBe(false);
    expect(body.payment_status).toBe("recognized");
    expect(body.second_payment_required).toBe(false);
    expect(body.message).toMatch(/No additional payment/i);
    expect(body.machine_continuation).toBeNull();
  });

  it("product_discovery stage is automatic with machine continuation", () => {
    const body = marketplaceIncompleteContract({
      stage: "product_discovery",
      journeyId: "journey_disc",
    });
    expect(body.fields).toEqual([]);
    expect(body.requiredArgs).toEqual([]);
    expect(body.input_required).toBe(false);
    expect(body.automatic_continue).toBe(true);
    expect(body.completed_step).toBe("PURCHASE_DETAILS_CAPTURED");
    expect(body.next_action).toBe("RUN_PRODUCT_DISCOVERY");
    expect(body.machine_continuation).toEqual(
      expect.objectContaining({
        method: "POST",
        service_id: 33561,
        do_not_ask_user: true,
        body: { journey_id: "journey_disc" },
      }),
    );
    expect(String(body.guidance)).toMatch(/Do not ask the user to resubmit journey_id/i);
  });

  it("marketplace first contact presents both services without assuming payment", () => {
    const first = marketplaceFirstContact();
    expect(first.http_status).toBe(400);
    expect(first.body.status).toBe("SERVICE_SELECTION_REQUIRED");
    expect(first.body.payment_status).toBe("not_required");
    expect(first.body.second_payment_required).toBe(false);
    expect(first.body.fields).toEqual(["service_id"]);
    expect(first.body.requiredArgs).toEqual(["service_id"]);
    const services = first.body.available_services as ReadonlyArray<{
      service_id: number;
    }>;
    expect(services.map((s) => s.service_id)).toEqual([33561, 35958]);
    expect(String(first.body.message)).toMatch(/33561/);
    expect(String(first.body.message)).toMatch(/35958/);
    expect(String(first.body.guidance)).toMatch(/Do not assume a service/i);
  });
});
