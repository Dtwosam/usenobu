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
    expect(c.fields).toEqual(["action", "pass_continuation_id"]);
    expect(c.requiredArgs).toEqual(c.fields);
    expect(c.pass_continuation_id).toBe("pass_cont_abc");
  });

  it("marketplace incomplete stages ask one focused input", () => {
    const body = marketplaceIncompleteContract({
      stage: "confirm_use_pass",
      journeyId: "journey_test",
      monitoringPassId: "pass_test",
    });
    expect(body.status).toBe("input_required");
    expect(body.fields).toEqual(["confirm_use_pass", "journey_id"]);
    expect(body.payment_status).toBe("recognized");
    expect(body.second_payment_required).toBe(false);
    expect(body.message).toMatch(/No additional payment/i);
  });

  it("marketplace first contact explains free vs paid and never forces a second charge", () => {
    const first = marketplaceFirstContact();
    expect(first.http_status).toBe(400);
    expect(first.body.status).toBe("input_required");
    expect(first.body.payment_status).toBe("required");
    expect(first.body.second_payment_required).toBe(false);
    expect(String(first.body.message)).toMatch(/0\.99/);
    expect(String(first.body.guidance)).toMatch(/35958/);
    expect(first.body.fields).toEqual(["monitoring_pass_id"]);
  });
});
