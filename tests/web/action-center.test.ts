/**
 * FIXTURE — Action Center helpers (no live network).
 */
import { describe, expect, it } from "vitest";
import {
  ACTION_TRUST_NOTE,
  buildCopyDetailsText,
  copyTextIsSafe,
  resolveStoredDataSource,
  shouldShowActionCenter,
  buildActionCenterModel,
  COPY_CLOSING,
} from "../../src/web/action-center.js";
import {
  resolveTrustedTargetProductUrl,
  validateTrustedTargetProductUrl,
  TARGET_OFFICIAL_CONTACT_URL,
  isOfficialTargetContactUrl,
} from "../../src/web/target-url.js";

describe("Action Center target URL (fixture)", () => {
  it("accepts HTTPS Target product URLs", () => {
    const u = validateTrustedTargetProductUrl(
      "https://www.target.com/p/example-widget/-/A-87654321",
    );
    expect(u).toMatch(/^https:\/\/www\.target\.com\//);
  });

  it("rejects http, SerpApi, and unknown sellers", () => {
    expect(
      validateTrustedTargetProductUrl(
        "http://www.target.com/p/x/-/A-1",
      ),
    ).toBeNull();
    expect(
      validateTrustedTargetProductUrl("https://serpapi.com/search"),
    ).toBeNull();
    expect(
      validateTrustedTargetProductUrl("https://www.amazon.com/dp/x"),
    ).toBeNull();
    expect(validateTrustedTargetProductUrl(null)).toBeNull();
  });

  it("prefers fingerprint URL", () => {
    const u = resolveTrustedTargetProductUrl({
      fingerprint_url: "https://www.target.com/p/a/-/A-111",
      purchase_url: "https://evil.example/p",
    });
    expect(u).toContain("target.com");
    expect(u).toContain("111");
  });

  it("uses official contact URL", () => {
    expect(TARGET_OFFICIAL_CONTACT_URL).toBe(
      "https://www.target.com/help/contact-us",
    );
    expect(isOfficialTargetContactUrl(TARGET_OFFICIAL_CONTACT_URL)).toBe(true);
  });
});

describe("Action Center visibility and copy (fixture)", () => {
  it("shows only for valid lower-price recovery", () => {
    expect(
      shouldShowActionCenter({
        purchase_price: 40,
        observed_price: 30,
        potential_recovery: 10,
      }),
    ).toBe(true);
    expect(
      shouldShowActionCenter({
        purchase_price: 40,
        observed_price: 40,
        potential_recovery: 0,
      }),
    ).toBe(false);
    expect(
      shouldShowActionCenter({
        purchase_price: 40,
        observed_price: 45,
        potential_recovery: 5,
      }),
    ).toBe(false);
  });

  it("labels fixture observations from stored fields", () => {
    expect(
      resolveStoredDataSource({
        query: "demo-fixture-monitor",
        provider: "SerpApi",
      }),
    ).toBe("FIXTURE");
    expect(
      resolveStoredDataSource({
        query: "WDG-100 Target",
        provider: "SerpApi",
        raw_result_hash: "abc",
      }),
    ).toBe("LIVE");
  });

  it("copy details includes only approved fields", () => {
    const text = buildCopyDetailsText({
      product_title: "Example Widget",
      purchase_date: "2026-07-01",
      purchase_price: 39.99,
      observed_price: 29.99,
      potential_difference: 10,
      observed_at: "2026-07-10T12:00:00.000Z",
      monitoring_deadline: "2026-07-15",
      target_product_url: "https://www.target.com/p/example/-/A-87654321",
    });
    expect(text).toContain("Example Widget");
    expect(text).toContain("Purchase price: $39.99");
    expect(text).toContain("Observed price: $29.99");
    expect(text).toContain("Potential difference: $10.00");
    expect(text).toContain("third-party observation through SerpApi");
    expect(text).toContain(COPY_CLOSING);
    expect(text.toLowerCase()).not.toContain("password");
    expect(text.toLowerCase()).not.toContain("guarantee a refund");
    expect(text.toLowerCase()).not.toContain("target owes you");
    expect(copyTextIsSafe(text)).toBe(true);
  });

  it("trust note is compact", () => {
    expect(ACTION_TRUST_NOTE).toBe(
      "Third-party observed price. Target verifies and decides.",
    );
  });

  it("buildActionCenterModel wires open URL and fixture flag", () => {
    const model = buildActionCenterModel({
      alert: {
        purchase_price: 40,
        observed_price: 30,
        potential_recovery: 10,
        created_at: "2026-07-10T12:00:00.000Z",
      },
      purchase: {
        purchase_date: "2026-07-01",
        monitoring_deadline: "2026-07-15",
        target_product_url: "https://www.target.com/p/x/-/A-87654321",
      },
      observation: {
        query: "demo-fixture-monitor",
        provider: "SerpApi",
        observed_at: "2026-07-10T12:00:00.000Z",
        product_title: "Example Widget Blue",
      },
      fingerprint: {
        target_product_url: "https://www.target.com/p/x/-/A-87654321",
        product_title: "Example Widget Blue",
        target_item_id: "87654321",
      },
    });
    expect(model.show).toBe(true);
    expect(model.is_fixture).toBe(true);
    expect(model.trusted_target_url).toContain("target.com");
    expect(model.contact_url).toBe(TARGET_OFFICIAL_CONTACT_URL);
    expect(model.copy_text).toContain("Example Widget Blue");
  });

  it("hides open action when no trusted URL", () => {
    const model = buildActionCenterModel({
      alert: {
        purchase_price: 40,
        observed_price: 30,
        potential_recovery: 10,
      },
      purchase: { target_product_url: "https://not-target.example/p" },
      observation: { query: "demo-fixture-monitor", provider: "SerpApi" },
      fingerprint: { target_product_url: "https://serpapi.com/x" },
    });
    expect(model.trusted_target_url).toBeNull();
  });
});
