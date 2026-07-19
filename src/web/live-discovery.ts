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
import { buildMonitorShoppingQueryPlan } from "./live-monitor.js";
import type { TargetMatchFingerprint } from "../matching/confirm.js";
import { isFixtureCheckAllowed } from "./manual-check-mode.js";
import { isStrongMatchTier } from "../matching/rules.js";

export type DiscoveryDataSource = "LIVE" | "FIXTURE";

export interface LiveDiscoveryResult {
  ok: true;
  data_source: "LIVE";
  query: string;
  provider_status: string;
  offers: MatchableOffer[];
  evaluation: MatchEvaluationResult;
  searches_consumed_estimate: number;
  diagnostics: LiveDiscoveryDiagnostics;
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
  diagnostics?: LiveDiscoveryDiagnostics;
}

export type LiveDiscoveryOutcome = LiveDiscoveryResult | LiveDiscoveryFailure;

export type LiveDiscoveryPrimaryCause =
  | "NO_SHOPPING_RESULTS"
  | "NO_TARGET_RESULTS"
  | "TARGET_OFFER_ONLY_IN_IMMERSIVE"
  | "NORMALIZATION_DROPPED_TARGET_OFFER"
  | "QUERY_TOO_WEAK"
  | "IDENTITY_EVIDENCE_INSUFFICIENT"
  | "MATCHING_REJECTED_CORRECTLY"
  | "PROOF_INSTRUMENTATION_INSUFFICIENT";

export interface LiveDiscoveryDiagnostics {
  provider_calls_used: number;
  shopping_results_count: number;
  categorized_results_count: number;
  target_source_results_count: number;
  immersive_enrichment_used: boolean;
  immersive_offers_count: number;
  target_offers_after_enrichment: number;
  normalized_candidates_count: number;
  strong_candidates_count: number;
  rejection_reason_counts: Record<string, number>;
  final_discovery_reason: string;
  primary_cause: LiveDiscoveryPrimaryCause;
  query_strategy_identifier: string;
}

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

function countStrongCandidates(evaluation: MatchEvaluationResult): number {
  return evaluation.candidates.filter(
    (c) =>
      c.decision === "EXACT_MATCH_CANDIDATE" &&
      !c.title_only &&
      isStrongMatchTier(c.tier),
  ).length;
}

function safeReasonKey(reason: string | undefined): string {
  const key = String(reason ?? "unknown")
    .split("=")[0]!
    .split(":")[0]!
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  return key || "unknown";
}

function rejectionReasonCounts(
  evaluation: MatchEvaluationResult,
): Record<string, number> {
  const counts: Record<string, number> = {};
  const rejected = [
    ...evaluation.rejected,
    ...evaluation.candidates.filter((c) => c.decision === "REJECTED"),
  ];
  for (const candidate of rejected) {
    const key = safeReasonKey(candidate.reasons[0]);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(counts)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(0, 12),
  );
}

function classifyPrimaryCause(args: {
  shopping_results_count: number;
  target_source_results_count: number;
  immersive_enrichment_used: boolean;
  target_offers_after_enrichment: number;
  evaluation: MatchEvaluationResult;
}): LiveDiscoveryPrimaryCause {
  if (args.evaluation.decision === "EXACT_MATCH_CANDIDATE") {
    return "MATCHING_REJECTED_CORRECTLY";
  }
  if (args.shopping_results_count === 0) return "NO_SHOPPING_RESULTS";
  if (
    args.target_source_results_count === 0 &&
    args.target_offers_after_enrichment === 0
  ) {
    return "NO_TARGET_RESULTS";
  }
  if (
    args.target_source_results_count === 0 &&
    args.immersive_enrichment_used &&
    args.target_offers_after_enrichment > 0
  ) {
    return "TARGET_OFFER_ONLY_IN_IMMERSIVE";
  }
  if (args.evaluation.reasons.includes("no_target_candidates")) {
    return "NORMALIZATION_DROPPED_TARGET_OFFER";
  }
  if (
    args.evaluation.reasons.includes("title_only_insufficient") ||
    args.evaluation.reasons.includes("no_strong_match")
  ) {
    return "IDENTITY_EVIDENCE_INSUFFICIENT";
  }
  return "MATCHING_REJECTED_CORRECTLY";
}

function finalReason(evaluation: MatchEvaluationResult): string {
  if (evaluation.decision === "EXACT_MATCH_CANDIDATE") {
    return evaluation.reasons[0] ?? "exact_match_candidate";
  }
  return evaluation.reasons[0] ?? "match_review_required";
}

function buildDiagnostics(args: {
  provider_calls_used: number;
  shopping_results_count: number;
  categorized_results_count: number;
  target_source_results_count: number;
  immersive_enrichment_used: boolean;
  immersive_offers_count: number;
  target_offers_after_enrichment: number;
  evaluation: MatchEvaluationResult;
  query_strategy_identifier: string;
}): LiveDiscoveryDiagnostics {
  return {
    provider_calls_used: args.provider_calls_used,
    shopping_results_count: args.shopping_results_count,
    categorized_results_count: args.categorized_results_count,
    target_source_results_count: args.target_source_results_count,
    immersive_enrichment_used: args.immersive_enrichment_used,
    immersive_offers_count: args.immersive_offers_count,
    target_offers_after_enrichment: args.target_offers_after_enrichment,
    normalized_candidates_count: args.evaluation.candidates.length,
    strong_candidates_count: countStrongCandidates(args.evaluation),
    rejection_reason_counts: rejectionReasonCounts(args.evaluation),
    final_discovery_reason: finalReason(args.evaluation),
    primary_cause: classifyPrimaryCause({
      shopping_results_count: args.shopping_results_count,
      target_source_results_count: args.target_source_results_count,
      immersive_enrichment_used: args.immersive_enrichment_used,
      target_offers_after_enrichment: args.target_offers_after_enrichment,
      evaluation: args.evaluation,
    }),
    query_strategy_identifier: args.query_strategy_identifier,
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
  const fp = fingerprintFromPurchase(ref);
  const queryPlan = buildMonitorShoppingQueryPlan(fp);
  const query = queryPlan.query;
  const client =
    deps?.client !== undefined
      ? deps.client
      : createSerpApiClientFromEnv();

  if (!client) {
    const emptyEvaluation = evaluateProductMatches(ref, []);
    return {
      ok: false,
      data_source: "LIVE",
      error: "provider_not_configured",
      query,
      message: "Nobu could not find a reliable Target product right now.",
      diagnostics: buildDiagnostics({
        provider_calls_used: 0,
        shopping_results_count: 0,
        categorized_results_count: 0,
        target_source_results_count: 0,
        immersive_enrichment_used: false,
        immersive_offers_count: 0,
        target_offers_after_enrichment: 0,
        evaluation: emptyEvaluation,
        query_strategy_identifier: queryPlan.strategy,
      }),
    };
  }

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
      const emptyEvaluation = evaluateProductMatches(ref, []);
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
        diagnostics: buildDiagnostics({
          provider_calls_used: 1,
          shopping_results_count:
            shopping.result_counts?.shopping_results_count ??
            (shopping.offers ?? []).length,
          categorized_results_count:
            shopping.result_counts?.categorized_results_count ?? 0,
          target_source_results_count:
            shopping.result_counts?.target_offers_count ??
            (shopping.target_offers ?? []).length,
          immersive_enrichment_used: false,
          immersive_offers_count: 0,
          target_offers_after_enrichment: 0,
          evaluation: emptyEvaluation,
          query_strategy_identifier: queryPlan.strategy,
        }),
      };
    }

    let offers = (shopping.offers ?? []).map((o) => toMatchableOffer(o));
    let searches = 1;
    let immersive_enrichment_used = false;
    let immersive_offers_count = 0;

    // Pre-evaluate; if no strong enrollment candidate, one immersive enrich
    let evaluation = evaluateProductMatches(ref, offers);
    const hasFallbackIdentity = Boolean(ref.model_number || ref.upc_or_gtin);
    if (
      hasFallbackIdentity &&
      (evaluation.decision !== "EXACT_MATCH_CANDIDATE" ||
        !evaluation.exact_candidate ||
        evaluation.exact_candidate.title_only)
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
          immersive_enrichment_used = true;
          immersive_offers_count = enriched.enriched_count;
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
      diagnostics: buildDiagnostics({
        provider_calls_used: searches,
        shopping_results_count:
          shopping.result_counts?.shopping_results_count ??
          (shopping.offers ?? []).length,
        categorized_results_count:
          shopping.result_counts?.categorized_results_count ?? 0,
        target_source_results_count:
          shopping.result_counts?.target_offers_count ??
          (shopping.target_offers ?? []).length,
        immersive_enrichment_used,
        immersive_offers_count,
        target_offers_after_enrichment: offers.filter(
          (o) => o.seller_kind === "target" && !o.is_target_plus,
        ).length,
        evaluation,
        query_strategy_identifier: queryPlan.strategy,
      }),
    };
  } catch {
    const emptyEvaluation = evaluateProductMatches(ref, []);
    return {
      ok: false,
      data_source: "LIVE",
      error: "provider_error",
      query,
      message: "Nobu could not find a reliable Target product right now.",
      diagnostics: buildDiagnostics({
        provider_calls_used: 1,
        shopping_results_count: 0,
        categorized_results_count: 0,
        target_source_results_count: 0,
        immersive_enrichment_used: false,
        immersive_offers_count: 0,
        target_offers_after_enrichment: 0,
        evaluation: emptyEvaluation,
        query_strategy_identifier: queryPlan.strategy,
      }),
    };
  }
}
