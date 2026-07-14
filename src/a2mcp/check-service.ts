import {
  A2mcpResponseSchema,
  safeParseA2mcpRequest,
  type A2mcpRequest,
  type A2mcpResponse,
  type A2mcpStatus,
} from "./schemas.js";
import { evaluateTargetPolicy } from "../policy/evaluate-target-policy.js";
import {
  DEFAULT_POLICY_DISCLAIMER,
  TARGET_US_POLICY,
} from "../policy/target-us-policy.js";
import { POLICY_ID_TARGET_US_V1 } from "../domain/enums.js";
import type { MatchableOffer, TargetMatchFingerprint } from "../matching/index.js";
import {
  createSerpApiClientFromEnv,
  type NormalizedShoppingOffer,
  type SerpApiShoppingClient,
} from "../serpapi/index.js";
import { enrichOffersWithImmersiveTargetLinks } from "../serpapi/enrich-target-links.js";
import { toMatchableOffer } from "../matching/candidates.js";
import { assertResponseHasNoSecrets } from "./audit.js";
import { evaluateObservationAgainstFingerprint } from "../monitoring/detect.js";
import { buildMonitorShoppingQuery } from "../web/live-monitor.js";

export interface A2mcpCheckDeps {
  /** Inject SerpApi client; null forces fixture or unavailable. */
  serpClient?: SerpApiShoppingClient | null;
  /** Inject offers for tests (no network). */
  offersOverride?: MatchableOffer[] | NormalizedShoppingOffer[];
  /** Force provider failure for tests. */
  forceProviderError?: boolean;
  now?: () => Date;
  /** Skip policy freshness for deterministic unit tests. */
  skipPolicyFreshness?: boolean;
}

export interface A2mcpCheckResult {
  http_status: 200 | 400 | 429 | 503;
  body: A2mcpResponse | { error: string; details?: unknown };
}

function baseResponse(
  status: A2mcpStatus,
  checkedAt: string,
  extra: Partial<A2mcpResponse> = {},
): A2mcpResponse {
  const body: A2mcpResponse = {
    status,
    policy_id: POLICY_ID_TARGET_US_V1,
    price_source_type: "THIRD_PARTY_SEARCH_OBSERVATION",
    final_decision_by: "Target",
    checked_at: checkedAt,
    provider: "SerpApi",
    disclaimer: DEFAULT_POLICY_DISCLAIMER,
    official_next_action: {
      online_chat: TARGET_US_POLICY.claim_route.online_chat,
      guest_services_phone: TARGET_US_POLICY.claim_route.guest_services_phone,
    },
    ...extra,
  };
  return A2mcpResponseSchema.parse(body);
}

function titleFromTrustedTargetUrl(
  targetProductUrl: string,
  modelNumber?: string,
): string | undefined {
  try {
    const u = new URL(targetProductUrl);
    const slug = u.pathname.split("/").filter(Boolean)[1] ?? "product";
    return modelEquivalentTitleFromSlug(slug, modelNumber);
  } catch {
    return undefined;
  }
}

function modelEquivalentTitleFromSlug(
  slug: string,
  modelNumber?: string,
): string {
  const words = slug.replace(/-/g, " ").replace(/\s+/g, " ").trim().split(" ");
  const normalizedModel = (modelNumber ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");
  if (!normalizedModel) return words.join(" ");

  for (let start = 0; start < words.length; start += 1) {
    let phrase = "";
    for (let end = start; end < words.length; end += 1) {
      phrase += words[end]!.toUpperCase().replace(/[^A-Z0-9]+/g, "");
      if (phrase === normalizedModel) {
        const leadingIdentity = start > 0 ? words[0] : undefined;
        return [leadingIdentity, ...words.slice(start, end + 1)]
          .filter(Boolean)
          .join(" ");
      }
      if (phrase.length >= normalizedModel.length) break;
    }
  }
  return words.join(" ");
}

export function canonicalRequestFingerprint(req: A2mcpRequest): TargetMatchFingerprint {
  return {
    target_product_url: req.target_product_url,
    target_item_id: req.target_item_id,
    model_number: req.model_number,
    upc_or_gtin: req.upc_or_gtin,
    product_title: titleFromTrustedTargetUrl(
      req.target_product_url,
      req.model_number,
    ),
    seller_kind: "target",
    is_target_plus: false,
  };
}

/**
 * Free A2MCP one-time Target price check.
 * Reuses policy engine + matching engine — no duplicate business path.
 * Stateless: no SQLite / shared production persistence.
 */
export async function runA2mcpTargetPriceCheck(
  rawBody: unknown,
  deps: A2mcpCheckDeps = {},
): Promise<A2mcpCheckResult> {
  const checkedAt = (deps.now ?? (() => new Date()))().toISOString();
  const apiKey = process.env.SERPAPI_API_KEY ?? null;

  const parsed = safeParseA2mcpRequest(rawBody);
  if (!parsed.success) {
    return {
      http_status: 400,
      body: {
        error: "invalid_input",
        details: parsed.error.flatten(),
      },
    };
  }

  const req = parsed.data;
  const fingerprint = canonicalRequestFingerprint(req);

  // Policy first (channel, geography, window) — existing engine
  const policy = evaluateTargetPolicy(
    {
      purchase_channel: req.purchase_channel,
      country: req.country,
      region: req.region,
      purchase_date: req.purchase_date,
      purchase_price: req.purchase_price,
      currency: req.currency,
      has_receipt_or_packing_slip: true,
      has_locked_fingerprint: Boolean(req.user_confirmed_match_id),
      evaluated_at: checkedAt,
    },
    { skip_freshness_check: deps.skipPolicyFreshness === true },
  );

  if (
    policy.status === "UNSUPPORTED_PURCHASE" ||
    policy.status === "POLICY_EXCLUSION" ||
    policy.status === "WINDOW_EXPIRED" ||
    policy.status === "POLICY_STALE"
  ) {
    const status = policy.status as A2mcpStatus;
    const body = baseResponse(status, checkedAt, {
      purchase_price: req.purchase_price,
      currency: req.currency,
      days_remaining: policy.days_remaining,
    });
    assertResponseHasNoSecrets(body, apiKey);
    return { http_status: 200, body };
  }

  if (deps.forceProviderError) {
    const body = baseResponse("DATA_SOURCE_UNAVAILABLE", checkedAt, {
      purchase_price: req.purchase_price,
      currency: req.currency,
    });
    assertResponseHasNoSecrets(body, apiKey);
    return { http_status: 503, body };
  }

  let offers: Array<MatchableOffer | NormalizedShoppingOffer> =
    deps.offersOverride ?? [];

  if (!deps.offersOverride) {
    const client =
      deps.serpClient === undefined
        ? createSerpApiClientFromEnv()
        : deps.serpClient;

    if (!client) {
      // No key and no injected offers → provider unavailable (not fake live data).
      // Root cause of production 503 when SERPAPI_API_KEY is missing/empty on host.
      const body = baseResponse("DATA_SOURCE_UNAVAILABLE", checkedAt, {
        purchase_price: req.purchase_price,
        currency: req.currency,
        disclaimer: `${DEFAULT_POLICY_DISCLAIMER} Provider configuration missing on server (SERPAPI_API_KEY not available to runtime).`,
      });
      assertResponseHasNoSecrets(body, apiKey);
      return { http_status: 503, body };
    }

    try {
      const shopping = await client.searchShopping({
        q: buildMonitorShoppingQuery(fingerprint),
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
        const body = baseResponse("DATA_SOURCE_UNAVAILABLE", checkedAt, {
          purchase_price: req.purchase_price,
          currency: req.currency,
          disclaimer: `${DEFAULT_POLICY_DISCLAIMER} Third-party provider error or rate limit (not Target).`,
        });
        assertResponseHasNoSecrets(body, apiKey);
        return { http_status: 503, body };
      }

      // Normalize then optionally enrich Target merchant links via one immersive call
      let matchable = shopping.offers.map((o) => toMatchableOffer(o));
      const pre = evaluateObservationAgainstFingerprint({
        fingerprint,
        offers: matchable,
        purchase_price: req.purchase_price,
      });
      if (!pre.match_ok) {
        let reference_title: string | undefined;
        try {
          const slug = new URL(req.target_product_url).pathname
            .split("/")
            .filter(Boolean)[1];
          if (slug) reference_title = slug.replace(/-/g, " ");
        } catch {
          /* ignore */
        }
        try {
          const enriched = await enrichOffersWithImmersiveTargetLinks({
            client,
            offers: matchable,
            reference_title,
            expected_tcin: req.target_item_id,
            max_immersive_searches: 1,
          });
          matchable = enriched.offers;
        } catch {
          // Keep shopping-only offers on immersive failure
        }
      }
      offers = matchable;
    } catch {
      const body = baseResponse("DATA_SOURCE_UNAVAILABLE", checkedAt, {
        purchase_price: req.purchase_price,
        currency: req.currency,
        disclaimer: `${DEFAULT_POLICY_DISCLAIMER} Third-party provider request failed (not Target).`,
      });
      assertResponseHasNoSecrets(body, apiKey);
      return { http_status: 503, body };
    }
  }

  // Derive a soft title reference from the trusted Target URL slug when the
  // free A2MCP request has no product_title field (schema does not include it).
  // Used only for model-from-title similarity gates — never invents TCIN/UPC.
  const matchableOffers = offers.map((offer) => toMatchableOffer(offer));
  const match = evaluateObservationAgainstFingerprint({
    fingerprint,
    offers: matchableOffers,
    purchase_price: req.purchase_price,
  });

  if (match.ambiguous || !match.match_ok) {
    const body = baseResponse("MATCH_REVIEW_REQUIRED", checkedAt, {
      purchase_price: req.purchase_price,
      currency: req.currency,
      days_remaining: policy.days_remaining,
    });
    assertResponseHasNoSecrets(body, apiKey);
    return { http_status: 200, body };
  }

  if (!match.matched_offer) {
    const body = baseResponse("NO_RELIABLE_PRICE", checkedAt, {
      purchase_price: req.purchase_price,
      currency: req.currency,
      days_remaining: policy.days_remaining,
    });
    assertResponseHasNoSecrets(body, apiKey);
    return { http_status: 200, body };
  }

  const candidate = match.matched_offer;
  const observed = match.observed_price ?? candidate.observed_price;

  if (observed === undefined || observed === null || !(observed > 0)) {
    const body = baseResponse("NO_RELIABLE_PRICE", checkedAt, {
      purchase_price: req.purchase_price,
      currency: req.currency,
      days_remaining: policy.days_remaining,
    });
    assertResponseHasNoSecrets(body, apiKey);
    return { http_status: 200, body };
  }

  const matched_product = {
    title: candidate.title,
    seller: candidate.seller_text,
    seller_kind: candidate.seller_kind,
    match_tier: matchTierFromReasons(match.match_reasons),
    match_evidence: match.match_reasons,
    target_item_id: candidate.target_item_id,
    model_number: candidate.model_number,
    // Explicit: never expose raw secrets; product_id is Google id not TCIN
    note: "SerpApi product_id is not Target TCIN",
  };

  if (observed >= req.purchase_price) {
    const body = baseResponse("NO_PRICE_DROP", checkedAt, {
      purchase_price: req.purchase_price,
      observed_target_price: observed,
      potential_recovery: 0,
      currency: req.currency,
      days_remaining: policy.days_remaining,
      matched_product,
    });
    assertResponseHasNoSecrets(body, apiKey);
    return { http_status: 200, body };
  }

  const recovery =
    Math.round((req.purchase_price - observed) * 100) / 100;

  // Positive path: OpenAPI allows both PRICE_DROP_DETECTED and POTENTIALLY_ELIGIBLE
  // Use PRICE_DROP_DETECTED for lower observed price; disclaimer remains non-guaranteeing.
  const body = baseResponse("PRICE_DROP_DETECTED", checkedAt, {
    purchase_price: req.purchase_price,
    observed_target_price: observed,
    potential_recovery: recovery,
    currency: req.currency,
    days_remaining: policy.days_remaining,
    matched_product,
  });
  assertResponseHasNoSecrets(body, apiKey);
  return { http_status: 200, body };
}

function matchTierFromReasons(reasons: readonly string[]): string {
  if (reasons.includes("exact_target_url")) return "exact_target_url";
  if (reasons.includes("tcin")) return "exact_tcin";
  if (reasons.includes("model") || reasons.includes("model_from_title")) {
    return "exact_model_variant";
  }
  if (reasons.includes("upc")) return "exact_upc";
  return "none";
}
