import { describe, expect, it } from "vitest";
import {
  confirmProductMatch,
  evaluateProductMatches,
  generateTargetOnlyCandidates,
  MATCH_RULE_VERSION,
  MatchDecision,
  MatchTier,
  offerMatchesLockedFingerprint,
  scoreOfferAgainstPurchase,
  type MatchableOffer,
  type PurchaseMatchReference,
} from "../../src/matching/index.js";

const purchaseBase: PurchaseMatchReference = {
  purchase_id: "pur-1",
  target_product_url: "https://www.target.com/p/example-widget/-/A-87654321",
  target_item_id: "87654321",
  model_number: "WDG-100",
  product_title: "Example Widget Blue",
  size: "10 oz",
  color: "blue",
};

function targetOffer(
  overrides: Partial<MatchableOffer> = {},
): MatchableOffer {
  return {
    offer_id: "o1",
    title: "Example Widget Blue 10 oz",
    seller_kind: "target",
    seller_text: "Target",
    is_target_plus: false,
    merchant_link: "https://www.target.com/p/example-widget/-/A-87654321",
    target_item_id: "87654321",
    model_number: "WDG-100",
    size: "10 oz",
    color: "blue",
    observed_price: 12.99,
    currency: "USD",
    serpapi_product_id: "9999999999999999999",
    ...overrides,
  };
}

describe("Target-only candidate generation", () => {
  it("keeps Target and drops non-Target and Target Plus", () => {
    const offers: MatchableOffer[] = [
      targetOffer(),
      targetOffer({
        offer_id: "plus",
        seller_kind: "target_plus",
        seller_text: "Target Plus",
        is_target_plus: true,
      }),
      targetOffer({
        offer_id: "wm",
        seller_kind: "other",
        seller_text: "Walmart",
      }),
    ];
    const cands = generateTargetOnlyCandidates(offers);
    expect(cands).toHaveLength(1);
    expect(cands[0]?.seller_kind).toBe("target");
  });

  it("never treats serpapi product_id as TCIN", () => {
    const offer = targetOffer({
      target_item_id: null,
      merchant_link: "https://www.google.com/search?ibp=oshop",
      link: "https://www.google.com/search?ibp=oshop",
      product_link: "https://www.google.com/search?ibp=oshop",
      serpapi_product_id: "87654321",
      model_number: null,
      title: "Unrelated Product Without Model",
      size: null,
      color: null,
    });
    const scored = scoreOfferAgainstPurchase(
      {
        purchase_id: "pur-x",
        target_product_url: "https://www.target.com/p/example-widget",
        target_item_id: "87654321",
        model_number: null,
        product_title: "Example Widget",
      },
      offer,
    );
    // SerpApi id equals purchase TCIN digits but must not count as TCIN match
    expect(scored.matched_tcin).toBeUndefined();
    expect(scored.tier).not.toBe(MatchTier.EXACT_TCIN);
    expect(scored.decision).not.toBe(MatchDecision.EXACT_MATCH_CANDIDATE);
  });
});

describe("Deterministic matching matrix", () => {
  it("exact TCIN / Target URL match passes as EXACT_MATCH_CANDIDATE", () => {
    const result = evaluateProductMatches(purchaseBase, [targetOffer()]);
    expect(result.decision).toBe(MatchDecision.EXACT_MATCH_CANDIDATE);
    expect(result.exact_candidate?.tier).toBe(MatchTier.EXACT_TARGET_URL);
    expect(result.match_rule_version).toBe(MATCH_RULE_VERSION);
  });

  it("fails closed when Target TCIN conflicts with product name", () => {
    const result = evaluateProductMatches(
      {
        purchase_id: "pur-conflict",
        target_product_url:
          "https://www.target.com/p/apple-airtag-bluetooth-tracker/-/A-54191097",
        target_item_id: "54191097",
        product_title: "Apple AirTag Bluetooth Tracker",
      },
      [
        targetOffer({
          title: "Apple AirPods with Charging Case (2nd generation)",
          merchant_link:
            "https://www.target.com/p/apple-airpods-with-charging-case-2nd-generation/-/A-54191097",
          target_item_id: "54191097",
          model_number: null,
          size: null,
          color: null,
        }),
      ],
    );
    expect(result.decision).toBe(MatchDecision.MATCH_REVIEW_REQUIRED);
    expect(result.exact_candidate).toBeUndefined();
    expect(result.rejected[0]?.reasons).toContain(
      "product_title_conflicts_with_identifier",
    );
  });

  it("exact model + compatible variants passes", () => {
    const result = evaluateProductMatches(
      {
        purchase_id: "pur-model",
        target_product_url: "https://www.target.com/p/example-widget",
        target_item_id: null,
        model_number: "WDG-100",
        product_title: "Example Widget Blue",
        size: "10 oz",
        color: "blue",
      },
      [
        targetOffer({
          merchant_link: "https://www.target.com/p/example-widget-listing",
          target_item_id: null,
          model_number: "WDG-100",
          size: "10 oz",
          color: "blue",
        }),
      ],
    );
    expect(result.decision).toBe(MatchDecision.EXACT_MATCH_CANDIDATE);
    expect(result.exact_candidate?.tier).toBe(MatchTier.EXACT_MODEL_VARIANT);
  });

  it("wrong model fails closed", () => {
    const scored = scoreOfferAgainstPurchase(
      {
        purchase_id: "pur-m",
        target_product_url: "https://www.target.com/p/example-widget",
        model_number: "WDG-100",
        product_title: "Example Widget",
      },
      targetOffer({
        merchant_link: "https://www.target.com/p/other-widget",
        target_item_id: null,
        model_number: "WDG-200",
        title: "Example Widget WDG-200",
        size: null,
        color: null,
      }),
    );
    expect(scored.decision).toBe(MatchDecision.REJECTED);
    expect(scored.reasons).toContain("wrong_model");
  });

  it("wrong seller fails closed", () => {
    const result = evaluateProductMatches(purchaseBase, [
      targetOffer({
        seller_kind: "other",
        seller_text: "Walmart",
        is_target_plus: false,
      }),
    ]);
    expect(result.decision).toBe(MatchDecision.MATCH_REVIEW_REQUIRED);
    expect(result.rejected.some((r) => r.reasons.includes("non_target_seller"))).toBe(
      true,
    );
  });

  it("Target Plus fails closed", () => {
    const scored = scoreOfferAgainstPurchase(purchaseBase, {
      ...targetOffer({
        seller_kind: "target_plus",
        seller_text: "Target Plus",
        is_target_plus: true,
      }),
    });
    expect(scored.decision).toBe(MatchDecision.REJECTED);
    expect(scored.reasons).toContain("target_plus_excluded");
  });

  it("variant mismatch fails closed", () => {
    const scored = scoreOfferAgainstPurchase(purchaseBase, {
      ...targetOffer({ color: "red", title: "Example Widget Red" }),
    });
    expect(scored.decision).toBe(MatchDecision.REJECTED);
    expect(scored.reasons[0]).toBe("variant_mismatch");
  });

  it("ambiguous multiple strong Target candidates require review", () => {
    const result = evaluateProductMatches(
      {
        purchase_id: "pur-2",
        target_product_url: "https://www.target.com/p/acetaminophen",
        model_number: "UPUP-ACET-500",
        product_title: "up&up Acetaminophen 500 mg",
      },
      [
        targetOffer({
          offer_id: "a",
          title: "up&up Acetaminophen 500 mg Tablets UPUP-ACET-500",
          merchant_link: "https://www.target.com/p/a/-/A-10000001",
          target_item_id: "10000001",
          model_number: "UPUP-ACET-500",
          size: null,
          color: null,
        }),
        targetOffer({
          offer_id: "b",
          title: "up&up Acetaminophen 500 mg Caplets UPUP-ACET-500",
          merchant_link: "https://www.target.com/p/b/-/A-10000002",
          target_item_id: "10000002",
          model_number: "UPUP-ACET-500",
          size: null,
          color: null,
        }),
      ],
    );
    // Same model but different offer TCINs → ambiguous strong group
    expect(result.decision).toBe(MatchDecision.MATCH_REVIEW_REQUIRED);
    expect(result.reasons).toContain("ambiguous_multiple_strong_target_candidates");
    expect(result.exact_candidate).toBeUndefined();
  });

  it("title-only matches fail closed and cannot confirm", () => {
    const purchase = {
      purchase_id: "pur-3",
      target_product_url: "https://www.target.com/p/blue-widget-special",
      target_item_id: null as string | null,
      model_number: null as string | null,
      product_title: "Blue Widget Special Edition",
    };
    const result = evaluateProductMatches(purchase, [
      targetOffer({
        title: "Blue Widget Special Edition Bundle",
        merchant_link: "https://www.google.com/search?ibp=oshop&q=blue",
        link: "https://www.google.com/search?ibp=oshop&q=blue",
        product_link: "https://www.google.com/search?ibp=oshop&q=blue",
        target_item_id: null,
        model_number: null,
        size: null,
        color: null,
      }),
    ]);
    expect(result.decision).toBe(MatchDecision.MATCH_REVIEW_REQUIRED);
    expect(result.reasons).toContain("title_only_insufficient");
    expect(result.candidates[0]?.title_only).toBe(true);

    expect(() =>
      confirmProductMatch({
        purchase,
        candidate: result.candidates[0]!,
        confirmed_by_user: true,
      }),
    ).toThrow(/Title-only|weak match/i);
  });
});

describe("User confirmation and locked fingerprint", () => {
  it("confirmation creates a stable locked fingerprint", () => {
    const evaluation = evaluateProductMatches(purchaseBase, [targetOffer()]);
    expect(evaluation.exact_candidate).toBeDefined();

    const first = confirmProductMatch({
      purchase: purchaseBase,
      candidate: evaluation.exact_candidate!,
      confirmed_by_user: true,
      confirmed_at: "2026-07-13T18:00:00.000Z",
    });
    const second = confirmProductMatch({
      purchase: purchaseBase,
      candidate: evaluation.exact_candidate!,
      confirmed_by_user: true,
      confirmed_at: "2026-07-13T18:00:00.000Z",
    });

    expect(first.fingerprint.fingerprint_id).toBe(second.fingerprint.fingerprint_id);
    expect(first.fingerprint.seller_kind).toBe("target");
    expect(first.fingerprint.is_target_plus).toBe(false);
    expect(first.fingerprint.confirmed_by_user).toBe(true);
    expect(first.fingerprint.target_item_id).toBe("87654321");
    expect(first.match_rule_version).toBe(MATCH_RULE_VERSION);
  });

  it("locked fingerprint rejects wrong model on later offers", () => {
    const evaluation = evaluateProductMatches(purchaseBase, [targetOffer()]);
    const { fingerprint } = confirmProductMatch({
      purchase: purchaseBase,
      candidate: evaluation.exact_candidate!,
      confirmed_by_user: true,
      confirmed_at: "2026-07-13T18:00:00.000Z",
    });

    const later = offerMatchesLockedFingerprint(
      fingerprint,
      targetOffer({
        model_number: "WDG-999",
        target_item_id: "99999999",
        merchant_link: "https://www.target.com/p/x/-/A-99999999",
        title: "Example Widget WDG-999",
      }),
    );
    expect(later.match).toBe(false);
  });

  it("locked fingerprint accepts same TCIN Target offer", () => {
    const evaluation = evaluateProductMatches(purchaseBase, [targetOffer()]);
    const { fingerprint } = confirmProductMatch({
      purchase: purchaseBase,
      candidate: evaluation.exact_candidate!,
      confirmed_by_user: true,
      confirmed_at: "2026-07-13T18:00:00.000Z",
    });
    const later = offerMatchesLockedFingerprint(fingerprint, targetOffer());
    expect(later.match).toBe(true);
  });
});
