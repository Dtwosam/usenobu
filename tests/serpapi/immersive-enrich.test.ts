/**
 * Immersive parse + model-from-title safety (fixtures only).
 */
import { describe, expect, it } from "vitest";
import { parseImmersiveProductResponse } from "../../src/serpapi/immersive.js";
import { enrichOffersWithImmersiveTargetLinks } from "../../src/serpapi/enrich-target-links.js";
import { offerMatchesLockedFingerprint } from "../../src/matching/confirm.js";
import type { MatchableOffer } from "../../src/matching/types.js";
import type { LockedProductFingerprint } from "../../src/domain/product-fingerprint.js";
import type { SerpApiShoppingClient } from "../../src/serpapi/client.js";

const AIRTAG_FP: LockedProductFingerprint = {
  fingerprint_id: "fp_airtag",
  target_product_url: "https://www.target.com/p/apple-airtag/-/A-54191097",
  target_item_id: "54191097",
  model_number: "AirTag",
  product_title: "Apple AirTag",
  brand: "Apple",
  seller_kind: "target",
  is_target_plus: false,
  confirmed_at: "2026-07-14T00:00:00.000Z",
  confirmed_by_user: true,
};

function targetOffer(partial: Partial<MatchableOffer>): MatchableOffer {
  return {
    title: "Apple AirTag",
    seller_kind: "target",
    seller_text: "Target",
    is_target_plus: false,
    observed_price: 29.99,
    currency: "USD",
    ...partial,
  };
}

describe("model-from-title safety", () => {
  it("accepts exact Apple AirTag title via model token + high title similarity", () => {
    const r = offerMatchesLockedFingerprint(
      AIRTAG_FP,
      targetOffer({
        title: "Apple AirTag",
        merchant_link: null,
        link: "https://www.google.com/search?ibp=oshop",
        product_link: "https://www.google.com/search?ibp=oshop",
      }),
    );
    expect(r.match).toBe(true);
    expect(r.reasons.some((x) => x.startsWith("model"))).toBe(true);
  });

  it("rejects AirTag accessory titles (false model-from-title)", () => {
    for (const title of [
      "Apple AirTag Loop Case",
      "AirTag Silicone Puffer Keychain heyday",
      "Belkin Secure Wallet Insert for Apple AirTag",
    ]) {
      const r = offerMatchesLockedFingerprint(
        AIRTAG_FP,
        targetOffer({
          title,
          merchant_link: null,
          link: "https://www.google.com/search?ibp=oshop",
        }),
      );
      expect(r.match).toBe(false);
    }
  });
});

describe("immersive parse", () => {
  it("extracts Target store link and TCIN only from Target.com URL", () => {
    const parsed = parseImmersiveProductResponse({
      product_results: {
        title: "Conair ExtremeSteam Handheld Garment Steamer",
        stores: [
          {
            name: "Amazon.com",
            link: "https://www.amazon.com/dp/x",
            title: "Conair Steamer",
            extracted_price: 34.99,
          },
          {
            name: "Target",
            link: "https://www.target.com/p/conair-extremesteam-handheld-garment-steamer/-/A-87470797",
            title: "Conair ExtremeSteam Handheld Garment Steamer",
            extracted_price: 29.99,
          },
        ],
      },
    });
    expect(parsed.target_stores).toHaveLength(1);
    expect(parsed.target_stores[0]!.target_item_id).toBe("87470797");
    expect(parsed.target_stores[0]!.link).toContain("target.com");
  });

  it("does not enrich when immersive Target TCIN conflicts with expected", async () => {
    const client = {
      searchImmersiveProduct: async () => ({
        product_results: {
          title: "Conair ExtremeSteam Handheld Fabric Steamer",
          stores: [
            {
              name: "Target",
              link: "https://www.target.com/p/conair-fabric/-/A-1011636045",
              title: "Conair ExtremeSteam Handheld Fabric Steamer",
              extracted_price: 69.99,
            },
          ],
        },
      }),
    } as unknown as SerpApiShoppingClient;

    const offers: MatchableOffer[] = [
      targetOffer({
        title: "Conair ExtremeSteam Handheld Fabric Steamer",
        merchant_link: null,
        link: "https://www.google.com/search?ibp=oshop",
        immersive_product_page_token: "token-wrong",
        target_item_id: null,
      }),
    ];
    const result = await enrichOffersWithImmersiveTargetLinks({
      client,
      offers,
      reference_title: "Conair ExtremeSteam Handheld Garment Steamer",
      expected_tcin: "87470797",
    });
    // Title similarity too low → no immersive, or immersive TCIN conflict → no enrich
    expect(result.enriched_count).toBe(0);
    expect(result.offers[0]!.merchant_link).toBeNull();
  });

  it("enriches Google-only Target offer with immersive Target link", async () => {
    const client = {
      searchImmersiveProduct: async () => ({
        product_results: {
          title: "Conair ExtremeSteam Handheld Garment Steamer",
          stores: [
            {
              name: "Target",
              link: "https://www.target.com/p/conair/-/A-87470797",
              title: "Conair ExtremeSteam Handheld Garment Steamer",
              extracted_price: 29.99,
            },
          ],
        },
      }),
    } as unknown as SerpApiShoppingClient;

    const offers: MatchableOffer[] = [
      targetOffer({
        title: "Conair ExtremeSteam Handheld Garment Steamer",
        merchant_link: null,
        link: "https://www.google.com/search?ibp=oshop",
        product_link: "https://www.google.com/search?ibp=oshop",
        immersive_product_page_token: "token123",
        serpapi_product_id: "179297467000",
        target_item_id: null,
      }),
    ];

    const result = await enrichOffersWithImmersiveTargetLinks({
      client,
      offers,
      reference_title: "Conair ExtremeSteam Handheld Garment Steamer",
      expected_tcin: "87470797",
    });
    expect(result.immersive_searches).toBe(1);
    expect(result.enriched_count).toBe(1);
    expect(result.offers[0]!.merchant_link).toContain("A-87470797");
    expect(result.offers[0]!.target_item_id).toBe("87470797");

    const fp: LockedProductFingerprint = {
      fingerprint_id: "fp_conair",
      target_product_url:
        "https://www.target.com/p/conair-extremesteam-handheld-garment-steamer/-/A-87470797",
      target_item_id: "87470797",
      model_number: "GS14",
      product_title: "Conair ExtremeSteam Handheld Garment Steamer",
      brand: "Conair",
      seller_kind: "target",
      is_target_plus: false,
      confirmed_at: "2026-07-14T00:00:00.000Z",
      confirmed_by_user: true,
    };
    const match = offerMatchesLockedFingerprint(fp, result.offers[0]!);
    expect(match.match).toBe(true);
    expect(match.reasons).toContain("tcin");
  });
});
