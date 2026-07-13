/**
 * Clearly labelled demo fixtures for the consumer web flow.
 * Never present these as live SerpApi results.
 */
import type { MatchableOffer } from "../matching/types.js";

/** Short fixture banner body (heading "Demo data" is rendered by DemoDataBanner). */
export const FIXTURE_BANNER =
  "This screen uses test fixtures, not a live current Target price. DEMO FIXTURE DATA — not a live SerpApi response.";

export type FixtureScenario =
  | "exact_match"
  | "ambiguous"
  | "no_price"
  | "unsupported";

export function buildFixtureOffers(args: {
  scenario: FixtureScenario;
  target_product_url: string;
  target_item_id?: string;
  model_number?: string;
  product_title?: string;
}): MatchableOffer[] {
  if (args.scenario === "no_price" || args.scenario === "unsupported") {
    return [];
  }

  const tcin =
    args.target_item_id ||
    args.target_product_url.match(/\/A-(\d{5,12})/i)?.[1] ||
    "87654321";
  const model = args.model_number || "WDG-100";
  const title =
    args.product_title || `Example Widget ${model} (demo fixture)`;

  if (args.scenario === "ambiguous") {
    return [
      {
        offer_id: "fix-a",
        title: `${title} variant A`,
        seller_kind: "target",
        seller_text: "Target",
        is_target_plus: false,
        merchant_link: `https://www.target.com/p/demo-a/-/A-${tcin}`,
        target_item_id: tcin,
        model_number: model,
        observed_price: 18.99,
        currency: "USD",
        serpapi_product_id: "fixture-serpapi-id-a",
      },
      {
        offer_id: "fix-b",
        title: `${title} variant B`,
        seller_kind: "target",
        seller_text: "Target",
        is_target_plus: false,
        merchant_link: `https://www.target.com/p/demo-b/-/A-99999999`,
        target_item_id: "99999999",
        model_number: model,
        observed_price: 17.5,
        currency: "USD",
        serpapi_product_id: "fixture-serpapi-id-b",
      },
    ];
  }

  // exact_match
  return [
    {
      offer_id: "fix-exact",
      title,
      seller_kind: "target",
      seller_text: "Target",
      is_target_plus: false,
      merchant_link: args.target_product_url.includes("target.com")
        ? args.target_product_url
        : `https://www.target.com/p/demo/-/A-${tcin}`,
      target_item_id: tcin,
      model_number: model,
      observed_price: 19.99,
      currency: "USD",
      serpapi_product_id: "fixture-serpapi-id-exact",
    },
  ];
}

/** Simulated later observation for monitoring demo (lower price). */
export function buildFixtureMonitorOffers(args: {
  target_product_url: string;
  target_item_id?: string | null;
  model_number?: string | null;
  product_title?: string | null;
  observed_price: number;
}): MatchableOffer[] {
  const tcin = args.target_item_id || "87654321";
  return [
    {
      offer_id: "fix-monitor",
      title: args.product_title || "Example Widget (demo fixture)",
      seller_kind: "target",
      seller_text: "Target",
      is_target_plus: false,
      merchant_link: args.target_product_url,
      target_item_id: tcin,
      model_number: args.model_number || undefined,
      observed_price: args.observed_price,
      currency: "USD",
      serpapi_product_id: "fixture-monitor-id",
    },
  ];
}
