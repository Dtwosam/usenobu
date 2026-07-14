/**
 * FIXTURE — locked fingerprint monitoring match (Conair-style identifiers).
 */
import { describe, expect, it } from "vitest";
import {
  confirmProductMatch,
  evaluateProductMatches,
  offerMatchesLockedFingerprint,
  type MatchableOffer,
} from "../../src/matching/index.js";
import { buildMonitorShoppingQuery } from "../../src/web/live-monitor.js";
import type { LockedProductFingerprint } from "../../src/domain/product-fingerprint.js";
import { extractTcinFromTargetUrl } from "../../src/matching/identity.js";
import { deterministicExtract } from "../../src/ai/deterministic-extract.js";

const CONAIR_URL =
  "https://www.target.com/p/conair-extremesteam-handheld-garment-steamer-gs14/-/A-87470797";

const purchaseBase = {
  purchase_id: "pur-conair-1",
  target_product_url: CONAIR_URL,
  target_item_id: "87470797",
  model_number: "GS14",
  upc_or_gtin: "074108469755",
  product_title: "Conair ExtremeSteam Handheld Garment Steamer",
  brand: "Conair",
};

function conairOffer(overrides: Partial<MatchableOffer> = {}): MatchableOffer {
  return {
    offer_id: "o1",
    title: "Conair ExtremeSteam Handheld Garment Steamer GS14",
    seller_kind: "target",
    seller_text: "Target",
    is_target_plus: false,
    merchant_link: CONAIR_URL,
    target_item_id: "87470797",
    model_number: "GS14",
    upc_or_gtin: "074108469755",
    observed_price: 29.99,
    currency: "USD",
    serpapi_product_id: "google-product-id-not-tcin",
    ...overrides,
  };
}

describe("Conair GS14 locked monitoring match (fixture)", () => {
  it("extracts TCIN only from Target URLs", () => {
    expect(extractTcinFromTargetUrl(CONAIR_URL)).toBe("87470797");
    expect(
      extractTcinFromTargetUrl("https://www.google.com/shopping?q=87470797"),
    ).toBeNull();
  });

  it("AI deterministic extract preserves model, TCIN, UPC, URL", () => {
    const text = `
      I bought Conair ExtremeSteam Handheld Garment Steamer from Target today for $39.99.
      Model: GS14 TCIN 87470797 UPC 074108469755
      ${CONAIR_URL}
    `;
    const r = deterministicExtract(text);
    expect(r.extracted.model_number).toBe("GS14");
    expect(r.extracted.target_item_id).toBe("87470797");
    expect(r.extracted.upc_or_gtin).toBe("074108469755");
    expect(r.extracted.product_url).toContain("A-87470797");
  });

  it("query builder prefers model over title noise", () => {
    const fp = {
      fingerprint_id: "fp1",
      target_product_url: CONAIR_URL,
      target_item_id: "87470797",
      model_number: "GS14",
      upc_or_gtin: "074108469755",
      product_title: "Conair ExtremeSteam Handheld Garment Steamer",
      brand: "Conair",
      seller_kind: "target" as const,
      is_target_plus: false as const,
      confirmed_at: "2026-07-14T00:00:00.000Z",
      confirmed_by_user: true as const,
    } satisfies LockedProductFingerprint;
    const q = buildMonitorShoppingQuery(fp);
    expect(q).toContain("GS14");
    expect(q).toContain("Target");
    expect(q.toLowerCase()).not.toContain("i bought");
    expect(q).not.toContain("39.99");
    // Prefer model path over dumping entire title
    expect(q.split(" ").length).toBeLessThan(8);
  });

  it("accepts Target offer via exact URL (without repeating TCIN on offer fields)", () => {
    const evaluation = evaluateProductMatches(purchaseBase, [conairOffer()]);
    expect(evaluation.exact_candidate).toBeTruthy();
    const { fingerprint } = confirmProductMatch({
      purchase: purchaseBase,
      candidate: evaluation.exact_candidate!,
      confirmed_by_user: true,
      confirmed_at: "2026-07-14T12:00:00.000Z",
    });
    expect(fingerprint.target_item_id).toBe("87470797");
    expect(fingerprint.model_number).toMatch(/GS14/i);

    const liveStyle = offerMatchesLockedFingerprint(
      fingerprint,
      conairOffer({
        target_item_id: undefined,
        model_number: undefined,
        upc_or_gtin: undefined,
        merchant_link: CONAIR_URL,
        title: "Conair ExtremeSteam Handheld Garment Steamer",
        serpapi_product_id: "9999999999",
      }),
    );
    expect(liveStyle.match).toBe(true);
    expect(liveStyle.reasons).toContain("exact_target_url");
  });

  it("accepts Target offer via TCIN from Target URL only", () => {
    const evaluation = evaluateProductMatches(purchaseBase, [conairOffer()]);
    const { fingerprint } = confirmProductMatch({
      purchase: purchaseBase,
      candidate: evaluation.exact_candidate!,
      confirmed_by_user: true,
      confirmed_at: "2026-07-14T12:00:00.000Z",
    });
    const r = offerMatchesLockedFingerprint(
      fingerprint,
      conairOffer({
        target_item_id: undefined,
        model_number: undefined,
        upc_or_gtin: undefined,
        merchant_link: "https://www.target.com/p/other-slug/-/A-87470797",
        title: "Some Steamer Title Without Model",
      }),
    );
    expect(r.match).toBe(true);
    expect(r.reasons).toContain("tcin");
  });

  it("does not treat Google product_id as TCIN", () => {
    const evaluation = evaluateProductMatches(purchaseBase, [conairOffer()]);
    const { fingerprint } = confirmProductMatch({
      purchase: purchaseBase,
      candidate: evaluation.exact_candidate!,
      confirmed_by_user: true,
      confirmed_at: "2026-07-14T12:00:00.000Z",
    });
    const r = offerMatchesLockedFingerprint(
      fingerprint,
      conairOffer({
        target_item_id: undefined,
        model_number: undefined,
        upc_or_gtin: undefined,
        merchant_link: "https://www.google.com/shopping/product/87470797",
        link: "https://www.google.com/shopping/product/87470797",
        product_link: undefined,
        title: "Conair ExtremeSteam Handheld Garment Steamer",
        serpapi_product_id: "87470797",
      }),
    );
    expect(r.match).toBe(false);
    expect(r.reasons).toContain("insufficient_identity_for_locked_fingerprint");
  });

  it("model mismatch still fails", () => {
    const evaluation = evaluateProductMatches(purchaseBase, [conairOffer()]);
    const { fingerprint } = confirmProductMatch({
      purchase: purchaseBase,
      candidate: evaluation.exact_candidate!,
      confirmed_by_user: true,
      confirmed_at: "2026-07-14T12:00:00.000Z",
    });
    const r = offerMatchesLockedFingerprint(
      fingerprint,
      conairOffer({
        target_item_id: "11111111",
        model_number: "GS99",
        merchant_link: "https://www.target.com/p/x/-/A-11111111",
        title: "Conair Other Steamer GS99",
      }),
    );
    expect(r.match).toBe(false);
  });

  it("title-only still fails", () => {
    const evaluation = evaluateProductMatches(purchaseBase, [conairOffer()]);
    const { fingerprint } = confirmProductMatch({
      purchase: purchaseBase,
      candidate: evaluation.exact_candidate!,
      confirmed_by_user: true,
      confirmed_at: "2026-07-14T12:00:00.000Z",
    });
    const r = offerMatchesLockedFingerprint(
      fingerprint,
      conairOffer({
        target_item_id: undefined,
        model_number: undefined,
        upc_or_gtin: undefined,
        merchant_link: undefined,
        link: "https://www.google.com/shopping/product/abc",
        title: "Conair ExtremeSteam Handheld Garment Steamer",
      }),
    );
    expect(r.match).toBe(false);
  });

  it("non-Target seller still fails", () => {
    const evaluation = evaluateProductMatches(purchaseBase, [conairOffer()]);
    const { fingerprint } = confirmProductMatch({
      purchase: purchaseBase,
      candidate: evaluation.exact_candidate!,
      confirmed_by_user: true,
      confirmed_at: "2026-07-14T12:00:00.000Z",
    });
    const r = offerMatchesLockedFingerprint(
      fingerprint,
      conairOffer({
        seller_kind: "other",
        seller_text: "Walmart",
      }),
    );
    expect(r.match).toBe(false);
    expect(r.reasons).toContain("seller_not_target");
  });
});
