import { describe, expect, it } from "vitest";
import {
  safeParsePurchaseInput,
} from "../../src/domain/index.js";

const valid = {
  target_product_url: "https://www.target.com/p/example/-/A-12345678",
  purchase_price: 29.99,
  currency: "USD",
  purchase_date: "2026-07-01",
  country: "US",
  region: "CA",
  purchase_channel: "target_online",
  model_number: "ABC-100",
  target_item_id: "12345678",
};

describe("PurchaseInputSchema", () => {
  it("accepts a valid Target online purchase", () => {
    const result = safeParsePurchaseInput(valid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.currency).toBe("USD");
      expect(result.data.purchase_channel).toBe("target_online");
      expect(result.data.is_target_plus).toBe(false);
    }
  });

  it("rejects non-positive and invalid prices", () => {
    expect(
      safeParsePurchaseInput({ ...valid, purchase_price: 0 }).success,
    ).toBe(false);
    expect(
      safeParsePurchaseInput({ ...valid, purchase_price: -5 }).success,
    ).toBe(false);
    expect(
      safeParsePurchaseInput({ ...valid, purchase_price: Number.NaN }).success,
    ).toBe(false);
  });

  it("rejects non-USD currency", () => {
    expect(
      safeParsePurchaseInput({ ...valid, currency: "EUR" }).success,
    ).toBe(false);
  });

  it("rejects invalid and non-calendar dates", () => {
    expect(
      safeParsePurchaseInput({ ...valid, purchase_date: "07/01/2026" }).success,
    ).toBe(false);
    expect(
      safeParsePurchaseInput({ ...valid, purchase_date: "2026-02-30" }).success,
    ).toBe(false);
    expect(
      safeParsePurchaseInput({ ...valid, purchase_date: "not-a-date" }).success,
    ).toBe(false);
  });

  it("rejects non-Target URLs and non-online channels", () => {
    expect(
      safeParsePurchaseInput({
        ...valid,
        target_product_url: "https://www.walmart.com/ip/x",
      }).success,
    ).toBe(false);
    expect(
      safeParsePurchaseInput({
        ...valid,
        purchase_channel: "in_store",
      }).success,
    ).toBe(false);
  });

  it("rejects non-US country", () => {
    expect(safeParsePurchaseInput({ ...valid, country: "MX" }).success).toBe(
      false,
    );
  });
});
