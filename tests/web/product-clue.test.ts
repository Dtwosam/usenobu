import { describe, expect, it } from "vitest";
import {
  assessProductClues,
  canSubmitFindProduct,
  isMeaningfulDescription,
} from "../../src/web/product-clue.js";
import fs from "node:fs";
import path from "node:path";

describe("product clue assessment", () => {
  it("rejects whitespace-only and placeholder descriptions", () => {
    expect(isMeaningfulDescription("   ")).toBe(false);
    expect(isMeaningfulDescription("a")).toBe(false);
    expect(isMeaningfulDescription("n/a")).toBe(false);
    expect(isMeaningfulDescription("Apple AirPods")).toBe(true);
  });

  it("accepts description, URL, TCIN, model, or UPC as usable clues", () => {
    expect(
      assessProductClues({ product_description: "Apple AirPods" }).has_usable_clue,
    ).toBe(true);
    expect(
      assessProductClues({
        target_product_url:
          "https://www.target.com/p/apple-airtag/-/A-54191097",
      }).has_usable_clue,
    ).toBe(true);
    expect(assessProductClues({ target_item_id: "54191097" }).has_usable_clue).toBe(
      true,
    );
    expect(assessProductClues({ model_number: "MXP63LL/A" }).has_usable_clue).toBe(
      true,
    );
    expect(
      assessProductClues({ upc_or_gtin: "194252096261" }).has_usable_clue,
    ).toBe(true);
  });

  it("rejects malformed URL or TCIN alone as usable when invalid", () => {
    const badUrl = assessProductClues({
      target_product_url: "https://www.google.com/shopping",
    });
    expect(badUrl.has_usable_clue).toBe(false);
    expect(badUrl.has_blocking_identity_error).toBe(true);

    const badTcin = assessProductClues({ target_item_id: "abc" });
    expect(badTcin.has_usable_clue).toBe(false);
  });

  it("gates Find my product on price, date, and a usable clue", () => {
    expect(
      canSubmitFindProduct({
        purchase_price: "24.99",
        purchase_date: "2026-07-18",
        clues: {},
      }).ok,
    ).toBe(false);

    expect(
      canSubmitFindProduct({
        purchase_price: "24.99",
        purchase_date: "2026-07-18",
        clues: { product_description: "   " },
      }).ok,
    ).toBe(false);

    expect(
      canSubmitFindProduct({
        purchase_price: "24.99",
        purchase_date: "2026-07-18",
        clues: { product_description: "Apple AirPods" },
      }).ok,
    ).toBe(true);

    expect(
      canSubmitFindProduct({
        purchase_price: "24.99",
        purchase_date: "2026-07-18",
        clues: {
          target_product_url:
            "https://www.target.com/p/x/-/A-87654321",
        },
      }).ok,
    ).toBe(true);

    expect(
      canSubmitFindProduct({
        purchase_price: "24.99",
        purchase_date: "2026-07-18",
        clues: { target_item_id: "87654321" },
      }).ok,
    ).toBe(true);
  });
});

describe("production form has no mode selector", () => {
  it("does not render Exact product / Help me find controls", () => {
    const formPath = path.join(
      process.cwd(),
      "app",
      "purchases",
      "new",
      "PurchaseIntake.tsx",
    );
    const src = fs.readFileSync(formPath, "utf8");
    expect(src).not.toMatch(/How do you want to identify the product/i);
    expect(src).not.toMatch(/mode-exact/);
    expect(src).not.toMatch(/mode-find/);
    expect(src).not.toMatch(/Help me find the product/);
    expect(src).not.toMatch(/product_entry_mode/);
    expect(src).toMatch(/product-details-section/);
    expect(src).toMatch(/Add at least one product detail so Nobu can search for it/);
  });
});
