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
import {
  evaluateProductMatches,
  type MatchableOffer,
} from "../matching/index.js";
import {
  createSerpApiClientFromEnv,
  type NormalizedShoppingOffer,
  type SerpApiShoppingClient,
} from "../serpapi/index.js";
import { assertResponseHasNoSecrets } from "./audit.js";

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

function buildQuery(req: A2mcpRequest): string {
  const parts = [
    req.model_number,
    req.target_item_id,
    req.upc_or_gtin,
    "Target",
  ].filter(Boolean);
  if (parts.length >= 2) return parts.join(" ");
  // Fall back to URL path slug + Target
  try {
    const u = new URL(req.target_product_url);
    const slug = u.pathname.split("/").filter(Boolean)[1] ?? "product";
    return `${slug.replace(/-/g, " ")} Target`;
  } catch {
    return "Target product";
  }
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
        q: buildQuery(req),
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

      // Pass normalized offers through existing matching (TCIN only from Target URLs)
      offers = shopping.offers;
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

  const match = evaluateProductMatches(
    {
      target_product_url: req.target_product_url,
      target_item_id: req.target_item_id,
      model_number: req.model_number,
      upc_or_gtin: req.upc_or_gtin,
    },
    offers,
  );

  if (match.decision === "MATCH_REVIEW_REQUIRED") {
    const body = baseResponse("MATCH_REVIEW_REQUIRED", checkedAt, {
      purchase_price: req.purchase_price,
      currency: req.currency,
      days_remaining: policy.days_remaining,
    });
    assertResponseHasNoSecrets(body, apiKey);
    return { http_status: 200, body };
  }

  if (match.decision === "REJECTED" || !match.exact_candidate) {
    const body = baseResponse("NO_RELIABLE_PRICE", checkedAt, {
      purchase_price: req.purchase_price,
      currency: req.currency,
      days_remaining: policy.days_remaining,
    });
    assertResponseHasNoSecrets(body, apiKey);
    return { http_status: 200, body };
  }

  const candidate = match.exact_candidate;
  const observed = candidate.offer.observed_price;

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
    title: candidate.offer.title,
    seller: candidate.offer.seller_text,
    seller_kind: candidate.offer.seller_kind,
    match_tier: candidate.tier,
    target_item_id: candidate.matched_tcin ?? candidate.offer.target_item_id,
    model_number: candidate.matched_model ?? candidate.offer.model_number,
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
