import { describe, expect, it } from "vitest";
import {
  daysRemaining,
  formatUsd,
  matchDecisionLabel,
  statusLabel,
} from "../../src/web/status-copy.js";
import { purchaseFormError } from "../../src/web/error-copy.js";

describe("status copy", () => {
  it("maps monitoring statuses to plain English", () => {
    expect(statusLabel("MONITORING_ACTIVE")).toBe("Watching the price");
    expect(statusLabel("PRICE_DROP_DETECTED")).toBe("Price drop found");
    expect(statusLabel("MATCH_REVIEW_REQUIRED")).toBe(
      "Confirm your exact product",
    );
    expect(statusLabel("DATA_SOURCE_UNAVAILABLE")).toBe(
      "Price check temporarily unavailable",
    );
  });

  it("formats money and days remaining", () => {
    expect(formatUsd(19.9)).toBe("$19.90");
    expect(daysRemaining("2099-01-01", new Date("2098-12-31T12:00:00Z"))).toBe(
      1,
    );
  });

  it("labels match decisions without using enums as the only copy", () => {
    expect(matchDecisionLabel("EXACT_MATCH_CANDIDATE")).toContain("confirm");
    expect(matchDecisionLabel("MATCH_REVIEW_REQUIRED")).toContain("detail");
  });
});

describe("error copy", () => {
  it("explains unsupported purchases in plain English", () => {
    const err = purchaseFormError("unsupported_or_ineligible");
    expect(err.heading.toLowerCase()).toContain("supported");
    expect(err.nextAction.length).toBeGreaterThan(10);
    expect(err.code).toBe("unsupported_or_ineligible");
  });
});
