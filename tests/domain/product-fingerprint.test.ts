import { describe, expect, it } from "vitest";
import {
  isCompleteFingerprintIdentity,
  safeParseLockedProductFingerprint,
} from "../../src/domain/index.js";

const base = {
  fingerprint_id: "fp-1",
  target_product_url: "https://www.target.com/p/example/-/A-12345678",
  seller_kind: "target" as const,
  is_target_plus: false as const,
  confirmed_at: "2026-07-13T12:00:00.000Z",
  confirmed_by_user: true as const,
};

describe("LockedProductFingerprintSchema", () => {
  it("accepts a complete locked fingerprint with TCIN", () => {
    const result = safeParseLockedProductFingerprint({
      ...base,
      target_item_id: "12345678",
      model_number: "ABC-100",
    });
    expect(result.success).toBe(true);
  });

  it("fails incomplete fingerprints without strong identifiers", () => {
    const result = safeParseLockedProductFingerprint({
      ...base,
      product_title: "Example Widget only",
    });
    expect(result.success).toBe(false);
    expect(isCompleteFingerprintIdentity({})).toBe(false);
  });

  it("accepts model_number alone as strong identity", () => {
    expect(
      safeParseLockedProductFingerprint({
        ...base,
        model_number: "ABC-100",
      }).success,
    ).toBe(true);
  });

  it("accepts upc_or_gtin alone as strong identity", () => {
    expect(
      safeParseLockedProductFingerprint({
        ...base,
        upc_or_gtin: "00012345678905",
      }).success,
    ).toBe(true);
  });

  it("rejects Target Plus lock attempts", () => {
    expect(
      safeParseLockedProductFingerprint({
        ...base,
        target_item_id: "12345678",
        is_target_plus: true,
      }).success,
    ).toBe(false);
  });

  it("rejects non-Target seller_kind", () => {
    expect(
      safeParseLockedProductFingerprint({
        ...base,
        target_item_id: "12345678",
        seller_kind: "other",
      }).success,
    ).toBe(false);
  });

  it("rejects unconfirmed fingerprints", () => {
    expect(
      safeParseLockedProductFingerprint({
        ...base,
        target_item_id: "12345678",
        confirmed_by_user: false,
      }).success,
    ).toBe(false);
  });
});
