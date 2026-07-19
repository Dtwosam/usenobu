import { describe, expect, it } from "vitest";
import {
  evaluateExactIdentity,
  provisionalTitleFromTargetUrl,
  provisionalTitleFromTcin,
  resolveEffectiveTcin,
  synthesizeTargetUrlFromTcin,
} from "../../src/web/exact-identity.js";
import { hasAnyDemoDefault } from "../../src/web/demo-defaults.js";
import { parseTargetProductUrl } from "../../src/matching/identity.js";
import { computeMissingFields } from "../../src/ai/schemas.js";

describe("exact identity requirements", () => {
  it("accepts Target URL alone", () => {
    const fromUrlOnly = evaluateExactIdentity({
      target_product_url: "https://www.target.com/p/x/-/A-54191097",
    });
    expect(fromUrlOnly.ok).toBe(true);
    expect(fromUrlOnly.effective_tcin).toBe("54191097");
    expect(fromUrlOnly.has_target_url).toBe(true);
    expect(fromUrlOnly.has_model_or_upc).toBe(false);
  });

  it("accepts TCIN alone without Target URL", () => {
    const tcinOnly = evaluateExactIdentity({
      target_item_id: "54191097",
    });
    expect(tcinOnly.ok).toBe(true);
    expect(tcinOnly.effective_tcin).toBe("54191097");
    expect(tcinOnly.has_target_url).toBe(false);
    expect(tcinOnly.url_synthesized_from_tcin).toBe(true);
    expect(tcinOnly.effective_url).toBe(
      "https://www.target.com/p/-/A-54191097",
    );
    expect(tcinOnly.errors.target_product_url).toBeUndefined();
  });

  it("rejects exact mode when both URL and TCIN are missing", () => {
    const empty = evaluateExactIdentity({});
    expect(empty.ok).toBe(false);
    expect(empty.errors.identity).toMatch(/link or a TCIN/i);
  });

  it("rejects conflicting URL and TCIN", () => {
    const conflict = evaluateExactIdentity({
      target_product_url: "https://www.target.com/p/x/-/A-54191097",
      target_item_id: "99999999",
    });
    expect(conflict.ok).toBe(false);
    expect(conflict.errors.target_item_id).toMatch(/does not match/i);
  });

  it("rejects malformed TCIN when provided", () => {
    const bad = evaluateExactIdentity({
      target_item_id: "gpc_notadigit",
    });
    expect(bad.ok).toBe(false);
    expect(bad.errors.target_item_id).toMatch(/valid Target item number/i);
  });

  it("rejects non-Target URL when provided", () => {
    const bad = evaluateExactIdentity({
      target_product_url: "https://www.google.com/shopping?q=A-54191097",
    });
    expect(bad.ok).toBe(false);
    expect(bad.errors.target_product_url).toBeTruthy();
  });

  it("does not require both model and UPC", () => {
    const onlyModel = evaluateExactIdentity({
      target_product_url: "https://www.target.com/p/x/-/A-87654321",
      target_item_id: "87654321",
      model_number: "WDG-100",
    });
    expect(onlyModel.ok).toBe(true);
    expect(onlyModel.has_upc).toBe(false);

    const onlyUpc = evaluateExactIdentity({
      target_product_url: "https://www.target.com/p/x/-/A-87654321",
      target_item_id: "87654321",
      upc_or_gtin: "012345678905",
    });
    expect(onlyUpc.ok).toBe(true);
    expect(onlyUpc.has_model).toBe(false);
  });

  it("extracts TCIN from trusted Target URL only", () => {
    expect(
      resolveEffectiveTcin({
        target_product_url:
          "https://www.target.com/p/apple-airtag/-/A-54191097",
      }),
    ).toBe("54191097");

    expect(
      resolveEffectiveTcin({
        target_product_url: "https://www.google.com/shopping?q=A-54191097",
        target_item_id: "",
      }),
    ).toBeNull();

    // Explicit TCIN wins over URL for effective tcin value
    expect(
      resolveEffectiveTcin({
        target_product_url:
          "https://www.target.com/p/apple-airtag/-/A-54191097",
        target_item_id: "99999999",
      }),
    ).toBe("99999999");
  });

  it("parses and normalizes supported Target product URLs without network", () => {
    const parsed = parseTargetProductUrl(
      "https://www.target.com/p/apple-airtag-bluetooth-tracker/-/A-54191097?ref=tgt_adv#details",
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.original_url).toContain("?ref=tgt_adv#details");
      expect(parsed.normalized_url).toBe(
        "https://www.target.com/p/apple-airtag-bluetooth-tracker/-/a-54191097",
      );
      expect(parsed.tcin).toBe("54191097");
      expect(parsed.slug_tokens).toEqual([
        "apple",
        "airtag",
        "bluetooth",
        "tracker",
      ]);
      expect(parsed.product_name).toBe("apple airtag bluetooth tracker");
    }
  });

  it("rejects malformed, non-Target, and Target URLs without TCIN", () => {
    expect(parseTargetProductUrl("not a url")).toMatchObject({
      ok: false,
      code: "INVALID_TARGET_URL",
    });
    expect(
      parseTargetProductUrl("https://www.google.com/shopping?q=A-54191097"),
    ).toMatchObject({ ok: false, code: "INVALID_TARGET_URL" });
    expect(parseTargetProductUrl("https://www.target.com/s?searchTerm=airtag"))
      .toMatchObject({
        ok: false,
        code: "TARGET_IDENTIFIER_MISSING",
      });
  });

  it("never treats non-digit Google-style ids as TCIN", () => {
    expect(
      resolveEffectiveTcin({
        target_item_id: "gpc_abc123notadigit",
      }),
    ).toBeNull();
  });

  it("does not inject demo defaults", () => {
    const empty = evaluateExactIdentity({});
    expect(empty.ok).toBe(false);
    expect(empty.effective_tcin).toBeNull();
    expect(
      hasAnyDemoDefault({
        target_product_url: "",
        target_item_id: empty.effective_tcin,
      }),
    ).toBe(false);
  });

  it("populates provisional title from URL slug (link-derived)", () => {
    const title = provisionalTitleFromTargetUrl(
      "https://www.target.com/p/apple-airtag-bluetooth-tracker/-/A-54191097",
    );
    expect(title).toMatch(/Apple/i);
    expect(title).toMatch(/Airtag/i);
    const identity = evaluateExactIdentity({
      target_product_url:
        "https://www.target.com/p/apple-airtag-bluetooth-tracker/-/A-54191097",
    });
    expect(identity.provisional_title).toBeTruthy();
  });

  it("uses neutral TCIN fallback title when no slug", () => {
    expect(provisionalTitleFromTcin("54191097")).toBe("Target item 54191097");
    expect(synthesizeTargetUrlFromTcin("54191097")).toContain("A-54191097");
  });
});

describe("Fill with AI missing-field validation", () => {
  it("does not request a link when TCIN is valid", () => {
    const missing = computeMissingFields({
      retailer: "Target",
      product_description: null,
      product_url: null,
      purchase_price: 29.99,
      currency: "USD",
      purchase_date: "2026-07-18",
      purchase_channel: "target_online",
      region: "TX",
      model_number: null,
      target_item_id: "54191097",
      upc_or_gtin: null,
    });
    expect(missing).not.toContain("product_url");
    expect(missing).not.toContain("product_url_or_tcin_or_description");
    expect(missing).toEqual([]);
  });

  it("accepts description-only for uncertain discovery path", () => {
    const missing = computeMissingFields({
      retailer: "Target",
      product_description: "Apple AirPods",
      product_url: null,
      purchase_price: 99.99,
      currency: "USD",
      purchase_date: "2026-07-18",
      purchase_channel: "target_online",
      region: "TX",
      model_number: null,
      target_item_id: null,
      upc_or_gtin: null,
    });
    expect(missing).toEqual([]);
  });

  it("rejects when neither exact identity nor description is present", () => {
    const missing = computeMissingFields({
      retailer: "Target",
      product_description: null,
      product_url: null,
      purchase_price: 10,
      currency: "USD",
      purchase_date: "2026-07-18",
      purchase_channel: "target_online",
      region: null,
      model_number: null,
      target_item_id: null,
      upc_or_gtin: null,
    });
    expect(missing).toContain("product_url_or_tcin_or_description");
  });
});
