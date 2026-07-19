import { describe, expect, it } from "vitest";
import {
  evaluateExactIdentity,
  resolveEffectiveTcin,
} from "../../src/web/exact-identity.js";
import { hasAnyDemoDefault } from "../../src/web/demo-defaults.js";
import { parseTargetProductUrl } from "../../src/matching/identity.js";

describe("exact identity requirements", () => {
  it("requires only supported Target URL identity before discovery", () => {
    const fromUrlOnly = evaluateExactIdentity({
      target_product_url: "https://www.target.com/p/x/-/A-54191097",
    });
    expect(fromUrlOnly.ok).toBe(true);
    expect(fromUrlOnly.effective_tcin).toBe("54191097");
    expect(fromUrlOnly.has_model_or_upc).toBe(false);

    const withModel = evaluateExactIdentity({
      target_product_url: "https://www.target.com/p/x/-/A-54191097",
      target_item_id: "54191097",
      model_number: "AirTag",
    });
    expect(withModel.ok).toBe(true);

    const withUpc = evaluateExactIdentity({
      target_product_url: "https://www.target.com/p/x/-/A-54191097",
      target_item_id: "54191097",
      upc_or_gtin: "194252096261",
    });
    expect(withUpc.ok).toBe(true);
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

    // Explicit TCIN wins over URL
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
});
