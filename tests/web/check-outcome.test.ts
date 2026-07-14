/**
 * FIXTURE — short decision explanations for monitoring proof UI.
 */
import { describe, expect, it } from "vitest";
import {
  alertActionLabel,
  checkOutcomeMessage,
  decisionBannerMessage,
  explainMatchReasons,
  suppressionReasonLabel,
} from "../../src/web/check-outcome.js";

describe("decision explanations (fixture)", () => {
  it("never surfaces raw enums as primary user copy", () => {
    const codes = [
      "no_lower",
      "price_drop",
      "ambiguous",
      "no_match",
      "no_reliable_price",
      "provider_unavailable",
      "window_ended",
      "cooldown",
    ] as const;
    for (const c of codes) {
      const msg = checkOutcomeMessage(c);
      expect(msg).not.toMatch(/MATCH_|NO_RELIABLE|WINDOW_EXPIRED|EXACT_/);
      expect(msg.length).toBeLessThan(120);
    }
  });

  it("explains seller and ambiguous rejections", () => {
    expect(explainMatchReasons(["non_target_seller"])).toMatch(/not confirmed as Target/);
    expect(explainMatchReasons(["ambiguous_candidates"])).toMatch(
      /More than one possible product/,
    );
    expect(explainMatchReasons(["model_mismatch"])).toMatch(
      /different model/,
    );
    expect(
      explainMatchReasons(["insufficient_identity_for_locked_fingerprint"]),
    ).toMatch(/enough details/);
  });

  it("decision banner prefers short outcomes", () => {
    expect(
      decisionBannerMessage({
        alert_created: true,
        notes: "alert_created",
      }),
    ).toBe("Possible price difference found.");
    expect(
      decisionBannerMessage({
        match_result: "rejected:non_target_seller",
      }),
    ).toMatch(/not confirmed as Target/);
  });

  it("labels alert create vs suppress", () => {
    expect(alertActionLabel({ alert_id: "a1" })).toBe("Alert created");
    expect(
      alertActionLabel({ notes: "alert_suppressed_not_lower", outcome: "checked" }),
    ).toBe("Alert suppressed");
  });

  it("suppression reasons stay plain", () => {
    expect(
      suppressionReasonLabel({
        notes: "alert_suppressed_not_lower",
      }),
    ).toMatch(/not lower/i);
    expect(
      suppressionReasonLabel({ skip_reason: "budget_exhausted" }),
    ).toMatch(/budget/i);
  });
});
