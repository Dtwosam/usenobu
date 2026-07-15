import { describe, expect, it } from "vitest";
import {
  evaluateExactIdentity,
  EXACT_IDENTITY_MISSING_MODEL_OR_UPC,
  resolveEffectiveTcin,
} from "../../src/web/exact-identity.js";
import { hasAnyDemoDefault } from "../../src/web/demo-defaults.js";

describe("exact identity requirements", () => {
  it("requires Target URL, TCIN, and model or UPC", () => {
    const missing = evaluateExactIdentity({
      target_product_url: "https://www.target.com/p/x/-/A-54191097",
      target_item_id: "54191097",
    });
    expect(missing.ok).toBe(false);
    expect(missing.errors.model_or_upc).toBe(
      EXACT_IDENTITY_MISSING_MODEL_OR_UPC,
    );

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
