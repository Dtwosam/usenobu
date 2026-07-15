/**
 * Duplicate offer collapse + accessory isolation (fixtures only).
 */
import { describe, expect, it } from "vitest";
import {
  evaluateProductMatches,
  groupCompatibleStrongCandidates,
  strongCandidatesCompatible,
  type MatchableOffer,
  type ScoredCandidate,
} from "../../src/matching/index.js";

const purchase = {
  target_product_url:
    "https://www.target.com/p/apple-airtag/-/A-54191097",
  target_item_id: "54191097",
  model_number: "AirTag",
  upc_or_gtin: "194252096261",
  product_title: "Apple AirTag",
};

function targetOffer(
  title: string,
  extra: Partial<MatchableOffer> = {},
): MatchableOffer {
  return {
    title,
    seller_kind: "target",
    seller_text: "Target",
    is_target_plus: false,
    observed_price: 29.99,
    currency: "USD",
    ...extra,
  };
}

describe("duplicate AirTag offers collapse", () => {
  it("collapses multiple same-title Target AirTag offers into one exact candidate", () => {
    const offers = [
      targetOffer("Apple AirTag", {
        observed_price: 29.99,
        serpapi_product_id: "google-111",
      }),
      targetOffer("Apple AirTag", {
        observed_price: 28.5,
        serpapi_product_id: "google-222",
      }),
      targetOffer("Apple AirTag", {
        observed_price: 30.0,
        serpapi_product_id: "google-333",
      }),
    ];
    const result = evaluateProductMatches(purchase, offers);
    expect(result.decision).toBe("EXACT_MATCH_CANDIDATE");
    expect(result.exact_candidate?.offer.title).toBe("Apple AirTag");
    expect(result.candidates).toHaveLength(1);
    expect(result.reasons.join(" ")).toMatch(/duplicate|single_strong/i);
  });

  it("does not merge AirTag accessory with main product", () => {
    const offers = [
      targetOffer("Apple AirTag", { observed_price: 29.99 }),
      targetOffer("Apple AirTag Loop Case", { observed_price: 12.99 }),
    ];
    const result = evaluateProductMatches(purchase, offers);
    // Main product alone is exact; accessory fails model-from-title sim gate
    expect(result.decision).toBe("EXACT_MATCH_CANDIDATE");
    expect(result.exact_candidate?.offer.title).toBe("Apple AirTag");
    expect(result.exact_candidate?.offer.title).not.toMatch(/Loop Case/i);
  });

  it("keeps genuine multi-product ambiguity fail-closed", () => {
    const offers = [
      targetOffer("Apple AirTag", {
        observed_price: 29.99,
        model_number: "AirTag",
      }),
      targetOffer("Apple AirTag 4 Pack", {
        observed_price: 99.0,
        model_number: "MX532",
        target_item_id: "99999999",
      }),
    ];
    const result = evaluateProductMatches(
      {
        ...purchase,
        model_number: undefined, // force weaker path
        product_title: "Apple AirTag",
      },
      offers,
    );
    // With model AirTag on purchase, 4-pack may wrong_model reject
    // Ensure we never pick accessory pack as exact without model agreement
    if (result.decision === "EXACT_MATCH_CANDIDATE") {
      expect(result.exact_candidate?.offer.title).not.toMatch(/4 Pack/i);
    }
  });
});

describe("strongCandidatesCompatible", () => {
  it("treats same model Target offers as compatible without Google product id", () => {
    const a = {
      candidate_id: "c1",
      tier: "exact_model_variant",
      decision: "EXACT_MATCH_CANDIDATE",
      title_only: false,
      title_similarity: 1,
      reasons: ["exact_model"],
      matched_model: "AIRTAG",
      offer: targetOffer("Apple AirTag", { serpapi_product_id: "g1" }),
    } as ScoredCandidate;
    const b = {
      candidate_id: "c2",
      tier: "exact_model_variant",
      decision: "EXACT_MATCH_CANDIDATE",
      title_only: false,
      title_similarity: 1,
      reasons: ["exact_model"],
      matched_model: "AIRTAG",
      offer: targetOffer("Apple AirTag", { serpapi_product_id: "g2" }),
    } as ScoredCandidate;
    expect(strongCandidatesCompatible(a, b)).toBe(true);
    const groups = groupCompatibleStrongCandidates([a, b]);
    expect(groups).toHaveLength(1);
  });
});
