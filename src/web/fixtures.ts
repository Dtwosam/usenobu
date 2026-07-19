/**
 * Clearly labelled demo fixtures for the consumer web flow.
 * Never present these as live SerpApi results.
 * Production form must not expose scenario controls — tests set env or inject.
 */
import type { MatchableOffer } from "../matching/types.js";

/** Short fixture banner body (heading "Demo data" is rendered by DemoDataBanner). */
export const FIXTURE_BANNER =
  "This screen uses test fixtures, not a live current Target price. DEMO FIXTURE DATA — not a live SerpApi response.";

export type FixtureScenario =
  | "exact_match"
  | "ambiguous"
  | "no_price"
  | "unsupported"
  | "multi_candidate";

/**
 * Resolve fixture scenario for test/e2e only.
 * Production path never reaches here when discovery mode is LIVE.
 * Prefer server env (NOBU_FIXTURE_SCENARIO); optional form value only when gate open.
 */
export function resolveFixtureScenario(
  requested?: string | null,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): FixtureScenario {
  const fromEnv = String(env.NOBU_FIXTURE_SCENARIO ?? "").trim();
  const raw = fromEnv || String(requested ?? "").trim() || "exact_match";
  if (
    raw === "exact_match" ||
    raw === "ambiguous" ||
    raw === "no_price" ||
    raw === "unsupported" ||
    raw === "multi_candidate"
  ) {
    return raw;
  }
  return "exact_match";
}

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

  if (args.scenario === "multi_candidate") {
    // Bounded multi-candidate Target list for uncertain-product discovery tests.
    // Includes non-Target + Target Plus noise to prove filtering, and a duplicate
    // TCIN pair to prove collapse.
    return [
      {
        offer_id: "fix-mc-1",
        title: "Apple AirPods (2nd Generation)",
        seller_kind: "target",
        seller_text: "Target",
        is_target_plus: false,
        merchant_link: "https://www.target.com/p/apple-airpods/-/A-54191091",
        target_item_id: "54191091",
        model_number: "MV7N2AM/A",
        observed_price: 99.99,
        currency: "USD",
        thumbnail: "https://example.test/airpods2.png",
        serpapi_product_id: "fixture-serpapi-airpods-2",
      },
      {
        offer_id: "fix-mc-2",
        title: "Apple AirPods Pro (2nd Generation)",
        seller_kind: "target",
        seller_text: "Target",
        is_target_plus: false,
        merchant_link:
          "https://www.target.com/p/apple-airpods-pro/-/A-87587261",
        target_item_id: "87587261",
        model_number: "MQD83AM/A",
        observed_price: 199.99,
        currency: "USD",
        thumbnail: "https://example.test/airpods-pro.png",
        serpapi_product_id: "fixture-serpapi-airpods-pro",
      },
      {
        offer_id: "fix-mc-3",
        title: "Apple AirPods (3rd Generation)",
        seller_kind: "target",
        seller_text: "Target",
        is_target_plus: false,
        merchant_link: "https://www.target.com/p/apple-airpods-3/-/A-85978641",
        target_item_id: "85978641",
        model_number: "MME73AM/A",
        observed_price: 139.99,
        currency: "USD",
        serpapi_product_id: "fixture-serpapi-airpods-3",
      },
      // Duplicate of mc-1 (same TCIN) — must collapse
      {
        offer_id: "fix-mc-1-dup",
        title: "Apple AirPods (2nd Generation) - White",
        seller_kind: "target",
        seller_text: "Target",
        is_target_plus: false,
        merchant_link: "https://www.target.com/p/apple-airpods/-/A-54191091",
        target_item_id: "54191091",
        model_number: "MV7N2AM/A",
        observed_price: 101.99,
        currency: "USD",
        serpapi_product_id: "fixture-serpapi-airpods-2-dup",
      },
      {
        offer_id: "fix-mc-4",
        title: "Apple AirPods Max",
        seller_kind: "target",
        seller_text: "Target",
        is_target_plus: false,
        merchant_link: "https://www.target.com/p/apple-airpods-max/-/A-82005796",
        target_item_id: "82005796",
        model_number: "MGYJ3AM/A",
        observed_price: 449.99,
        currency: "USD",
        serpapi_product_id: "fixture-serpapi-airpods-max",
      },
      {
        offer_id: "fix-mc-5",
        title: "Beats Studio Buds",
        seller_kind: "target",
        seller_text: "Target",
        is_target_plus: false,
        merchant_link: "https://www.target.com/p/beats-studio-buds/-/A-82988254",
        target_item_id: "82988254",
        model_number: "MJ4Y3LL/A",
        observed_price: 99.99,
        currency: "USD",
        serpapi_product_id: "fixture-serpapi-beats",
      },
      // Non-Target — must be excluded
      {
        offer_id: "fix-mc-walmart",
        title: "Apple AirPods Walmart listing",
        seller_kind: "other",
        seller_text: "Walmart",
        is_target_plus: false,
        merchant_link: "https://www.walmart.com/ip/airpods",
        observed_price: 89.99,
        currency: "USD",
        serpapi_product_id: "fixture-serpapi-walmart",
      },
      // Target Plus — must be excluded
      {
        offer_id: "fix-mc-plus",
        title: "Apple AirPods Target Plus",
        seller_kind: "target",
        seller_text: "Target Plus",
        is_target_plus: true,
        merchant_link: "https://www.target.com/p/airpods-plus/-/A-99999901",
        target_item_id: "99999901",
        observed_price: 79.99,
        currency: "USD",
        serpapi_product_id: "fixture-serpapi-plus",
      },
      // Title-only weak row (no TCIN/model/UPC/Target URL identity)
      {
        offer_id: "fix-mc-title-only",
        title: "Wireless earbuds similar to AirPods",
        seller_kind: "target",
        seller_text: "Target",
        is_target_plus: false,
        merchant_link: "https://www.google.com/shopping?q=earbuds",
        observed_price: 49.99,
        currency: "USD",
        serpapi_product_id: "fixture-serpapi-title-only",
      },
    ];
  }

  if (args.scenario === "ambiguous") {
    // Two strong model matches with distinct TCINs that do not equal the
    // purchase TCIN — fail closed as multi-candidate (user still supplied TCIN).
    return [
      {
        offer_id: "fix-a",
        title: `${title} variant A`,
        seller_kind: "target",
        seller_text: "Target",
        is_target_plus: false,
        merchant_link: `https://www.target.com/p/demo-a/-/A-11111111`,
        target_item_id: "11111111",
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
