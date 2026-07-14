/**
 * Live Target product discovery for enrollment (Find my product).
 * Reuses SerpApi client, monitor query builder, normalizer, optional immersive
 * enrich, and enrollment matcher (evaluateProductMatches).
 * Never invents fixtures on the production path.
 */
import {
  createSerpApiClientFromEnv,
  type SerpApiShoppingClient,
} from "../serpapi/index.js";
import { enrichOffersWithImmersiveTargetLinks } from "../serpapi/enrich-target-links.js";
import { toMatchableOffer } from "../matching/candidates.js";
import {
  evaluateProductMatches,
  type MatchEvaluationResult,
  type MatchableOffer,
  type PurchaseMatchReference,
} from "../matching/index.js";
import { buildMonitorShoppingQuery } from "./live-monitor.js";
import type { TargetMatchFingerprint } from "../matching/confirm.js";
import { isFixtureCheckAllowed } from "./manual-check-mode.js";

export type DiscoveryDataSource = "LIVE" | "FIXTURE";

export interface LiveDiscoveryResult {
  ok: true;
  data_source: "LIVE";
  query: string;
  provider_status: string;
  offers: MatchableOffer[];
  evaluation: MatchEvaluationResult;
  searches_consumed_estimate: number;
}

export interface LiveDiscoveryFailure {
  ok: false;
  data_source: "LIVE";
  error:
    | "provider_not_configured"
    | "provider_error"
    | "provider_rate_limited"
    | "no_reliable_target";
  query?: string;
  provider_status?: string;
  message: string;
}

export type LiveDiscoveryOutcome = LiveDiscoveryResult | LiveDiscoveryFailure;

/** Production discovery must never silently use fixtures. */
export function resolveDiscoveryDataSource(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): DiscoveryDataSource {
  // Explicit live force always wins
  if (env.NOBU_FORCE_LIVE_CHECKS === "1") return "LIVE";
  // Tests / e2e / explicit fixture mode may use fixtures
  if (isFixtureCheckAllowed(env)) return "FIXTURE";
  return "LIVE";
}

function fingerprintFromPurchase(
  ref: PurchaseMatchReference,
): TargetMatchFingerprint {
  return {
    target_product_url: ref.target_product_url,
    target_item_id: ref.target_item_id ?? undefined,
    model_number: ref.model_number ?? undefined,
    upc_or_gtin: ref.upc_or_gtin ?? undefined,
    product_title: ref.product_title ?? undefined,
    brand: ref.brand ?? undefined,
    seller_kind: "target",
    is_target_plus: false,
  };
}

/**
 * One bounded SerpApi Shopping search (+ optional immersive) for enrollment.
 */
export async function discoverLiveTargetCandidates(
  ref: PurchaseMatchReference,
  deps?: {
    client?: SerpApiShoppingClient | null;
    now?: () => Date;
  },
): Promise<LiveDiscoveryOutcome> {
  const client =
    deps?.client !== undefined
      ? deps.client
      : createSerpApiClientFromEnv();

  if (!client) {
    return {
      ok: false,
      data_source: "LIVE",
      error: "provider_not_configured",
      message: "Nobu could not find a reliable Target product right now.",
    };
  }

  const fp = fingerprintFromPurchase(ref);
  const query = buildMonitorShoppingQuery(fp);

  try {
    const shopping = await client.searchShopping({
      q: query,
      gl: "us",
      hl: "en",
      location: "Austin, Texas, United States",
      device: "desktop",
      timeout_ms: 20_000,
    });

    if (
      shopping.provider_status === "PROVIDER_ERROR" ||
      shopping.provider_status === "PROVIDER_RATE_LIMITED"
    ) {
      return {
        ok: false,
        data_source: "LIVE",
        error:
          shopping.provider_status === "PROVIDER_RATE_LIMITED"
            ? "provider_rate_limited"
            : "provider_error",
        query,
        provider_status: shopping.provider_status,
        message: "Nobu could not find a reliable Target product right now.",
      };
    }

    let offers = (shopping.offers ?? []).map((o) => toMatchableOffer(o));
    let searches = 1;

    // Pre-evaluate; if no strong enrollment candidate, one immersive enrich
    let evaluation = evaluateProductMatches(ref, offers);
    if (
      evaluation.decision !== "EXACT_MATCH_CANDIDATE" ||
      !evaluation.exact_candidate ||
      evaluation.exact_candidate.title_only
    ) {
      try {
        const enriched = await enrichOffersWithImmersiveTargetLinks({
          client,
          offers,
          reference_title: ref.product_title,
          expected_tcin: ref.target_item_id,
          max_immersive_searches: 1,
        });
        if (enriched.immersive_searches > 0) {
          searches += enriched.immersive_searches;
          offers = enriched.offers;
          evaluation = evaluateProductMatches(ref, offers);
        }
      } catch {
        // keep shopping-only
      }
    }

    return {
      ok: true,
      data_source: "LIVE",
      query,
      provider_status: shopping.provider_status,
      offers,
      evaluation,
      searches_consumed_estimate: searches,
    };
  } catch {
    return {
      ok: false,
      data_source: "LIVE",
      error: "provider_error",
      query,
      message: "Nobu could not find a reliable Target product right now.",
    };
  }
}
