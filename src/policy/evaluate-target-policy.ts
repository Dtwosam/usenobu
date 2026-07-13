import {
  FinalDecisionBy,
  PriceSourceType,
  type ResultStatus,
} from "../domain/enums.js";
import {
  parseTargetPolicyResult,
  type TargetPolicyResult,
} from "../domain/policy-result.js";
import {
  calendarDaysSincePurchase,
  hoursBetween,
  toUtcCalendarDateString,
} from "./dates.js";
import {
  DEFAULT_POLICY_DISCLAIMER,
  TARGET_US_POLICY,
  type TargetUsPolicy,
} from "./target-us-policy.js";

/**
 * Policy evaluation request. Broader than PurchaseInputSchema so unsupported
 * channels/regions and missing fields can be tested fail-closed without inventing matches.
 */
export interface TargetPolicyEvaluationInput {
  /** e.g. target_online | in_store | unknown */
  purchase_channel?: string | null;
  country?: string | null;
  region?: string | null;
  purchase_date?: string | null;
  purchase_price?: number | null;
  currency?: string | null;
  is_target_plus?: boolean;
  known_exclusion?: string | null;
  /** Receipt / packing slip evidence available (contract requirement). */
  has_receipt_or_packing_slip?: boolean;
  /** User confirmed locked fingerprint exists. */
  has_locked_fingerprint?: boolean;
  /** Observed Target online price from third-party source (not official Target API). */
  observed_target_price?: number | null;
  observed_currency?: string | null;
  /** When false, price cannot support a positive result. */
  observed_price_reliable?: boolean;
  /** Evaluation clock (ISO datetime). Defaults to now. */
  evaluated_at?: string;
  /**
   * Force stale policy path (fixture/tests). Otherwise computed from
   * policy.verified_at + max_freshness_hours vs evaluated_at.
   */
  force_policy_stale?: boolean;
}

export interface EvaluateTargetPolicyOptions {
  policy?: TargetUsPolicy;
  /** Override freshness check without changing official policy facts. */
  skip_freshness_check?: boolean;
}

function normalizeExclusion(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function isKnownExcludedCategory(
  known: string,
  policy: TargetUsPolicy,
): boolean {
  const n = normalizeExclusion(known);
  if ((policy.excluded_categories as readonly string[]).includes(n)) {
    return true;
  }
  if (
    (policy.fail_closed_ambiguous_exclusions as readonly string[]).includes(n)
  ) {
    return true;
  }
  // Map common synonyms used in fixtures to YAML categories.
  if (n === "clearance" || n.includes("clearance")) return true;
  if (n === "preorder" || n === "pre_order") return true;
  if (n.includes("coupon") || n.includes("bonus")) return true;
  return false;
}

function buildResult(
  partial: Omit<
    TargetPolicyResult,
    | "policy_id"
    | "policy_version"
    | "policy_verified_at"
    | "price_source_type"
    | "final_decision_by"
    | "disclaimer"
  > & {
    disclaimer?: string;
  },
  policy: TargetUsPolicy,
): TargetPolicyResult {
  return parseTargetPolicyResult({
    ...partial,
    policy_id: policy.policy_id,
    policy_version: policy.policy_version,
    policy_verified_at: policy.verified_at,
    price_source_type: PriceSourceType.THIRD_PARTY_SEARCH_OBSERVATION,
    final_decision_by: FinalDecisionBy.TARGET,
    disclaimer: partial.disclaimer ?? DEFAULT_POLICY_DISCLAIMER,
  });
}

/**
 * Deterministic Target policy evaluation (Lane 2).
 * Does not call SerpApi, does not match products, does not guarantee refunds.
 */
export function evaluateTargetPolicy(
  input: TargetPolicyEvaluationInput,
  options: EvaluateTargetPolicyOptions = {},
): TargetPolicyResult {
  const policy = options.policy ?? TARGET_US_POLICY;
  const evaluatedAt = input.evaluated_at ?? new Date().toISOString();

  // --- Freshness (POLICY_STALE) ---
  if (!options.skip_freshness_check) {
    const staleForced = input.force_policy_stale === true;
    const ageHours = hoursBetween(policy.verified_at, evaluatedAt);
    const staleByAge =
      ageHours !== null && ageHours > policy.max_freshness_hours;
    if (staleForced || staleByAge) {
      return buildResult(
        {
          status: "POLICY_STALE",
          check_status: "POLICY_STALE",
          evaluated_at: evaluatedAt,
          reasons: ["policy_verification_stale"],
          purchase_price: input.purchase_price ?? undefined,
          currency: input.currency === "USD" ? "USD" : undefined,
        },
        policy,
      );
    }
  }

  // --- Channel ---
  const channel = (input.purchase_channel ?? "").trim().toLowerCase();
  if (!channel) {
    return buildResult(
      {
        status: "UNSUPPORTED_PURCHASE",
        check_status: "UNSUPPORTED_PURCHASE",
        evaluated_at: evaluatedAt,
        reasons: ["missing_purchase_channel"],
      },
      policy,
    );
  }
  if (channel !== "target_online" && channel !== "online") {
    return buildResult(
      {
        status: "UNSUPPORTED_PURCHASE",
        check_status: "UNSUPPORTED_PURCHASE",
        evaluated_at: evaluatedAt,
        reasons: ["unsupported_purchase_channel", channel],
      },
      policy,
    );
  }

  // --- Geography ---
  const country = (input.country ?? "").trim().toUpperCase();
  if (!country) {
    return buildResult(
      {
        status: "UNSUPPORTED_PURCHASE",
        check_status: "UNSUPPORTED_PURCHASE",
        evaluated_at: evaluatedAt,
        reasons: ["missing_country"],
      },
      policy,
    );
  }
  if (country !== "US") {
    return buildResult(
      {
        status: "UNSUPPORTED_PURCHASE",
        check_status: "UNSUPPORTED_PURCHASE",
        evaluated_at: evaluatedAt,
        reasons: ["unsupported_country", country],
      },
      policy,
    );
  }

  const region = input.region?.trim().toUpperCase();
  if (
    region &&
    (policy.unsupported_regions as readonly string[]).includes(region)
  ) {
    return buildResult(
      {
        status: "UNSUPPORTED_PURCHASE",
        check_status: "UNSUPPORTED_PURCHASE",
        evaluated_at: evaluatedAt,
        reasons: ["unsupported_region", region],
      },
      policy,
    );
  }

  // --- Known exclusions / Target Plus ---
  if (input.is_target_plus === true) {
    return buildResult(
      {
        status: "POLICY_EXCLUSION",
        check_status: "POLICY_EXCLUSION",
        evaluated_at: evaluatedAt,
        reasons: ["target_plus_excluded"],
        purchase_price: input.purchase_price ?? undefined,
        currency: input.currency === "USD" ? "USD" : undefined,
      },
      policy,
    );
  }

  if (input.known_exclusion && input.known_exclusion.trim()) {
    if (isKnownExcludedCategory(input.known_exclusion, policy)) {
      return buildResult(
        {
          status: "POLICY_EXCLUSION",
          check_status: "POLICY_EXCLUSION",
          evaluated_at: evaluatedAt,
          reasons: [
            "known_exclusion",
            normalizeExclusion(input.known_exclusion),
          ],
          purchase_price: input.purchase_price ?? undefined,
          currency: input.currency === "USD" ? "USD" : undefined,
        },
        policy,
      );
    }
    // Unknown exclusion labels fail closed — do not invent support.
    return buildResult(
      {
        status: "POLICY_EXCLUSION",
        check_status: "POLICY_EXCLUSION",
        evaluated_at: evaluatedAt,
        reasons: [
          "unknown_exclusion_fail_closed",
          normalizeExclusion(input.known_exclusion),
        ],
        purchase_price: input.purchase_price ?? undefined,
        currency: input.currency === "USD" ? "USD" : undefined,
      },
      policy,
    );
  }

  // --- Purchase date / window ---
  if (!input.purchase_date || !String(input.purchase_date).trim()) {
    return buildResult(
      {
        status: "UNSUPPORTED_PURCHASE",
        check_status: "UNSUPPORTED_PURCHASE",
        evaluated_at: evaluatedAt,
        reasons: ["missing_purchase_date"],
      },
      policy,
    );
  }

  const purchaseDate = toUtcCalendarDateString(input.purchase_date);
  if (!purchaseDate) {
    return buildResult(
      {
        status: "UNSUPPORTED_PURCHASE",
        check_status: "UNSUPPORTED_PURCHASE",
        evaluated_at: evaluatedAt,
        reasons: ["invalid_purchase_date"],
      },
      policy,
    );
  }

  const daysSince = calendarDaysSincePurchase(purchaseDate, evaluatedAt);
  if (daysSince === null) {
    return buildResult(
      {
        status: "UNSUPPORTED_PURCHASE",
        check_status: "UNSUPPORTED_PURCHASE",
        evaluated_at: evaluatedAt,
        reasons: ["uncomputable_policy_window"],
      },
      policy,
    );
  }

  if (daysSince < 0) {
    return buildResult(
      {
        status: "UNSUPPORTED_PURCHASE",
        check_status: "UNSUPPORTED_PURCHASE",
        evaluated_at: evaluatedAt,
        reasons: ["future_purchase_date"],
      },
      policy,
    );
  }

  const windowDays = policy.window.days;
  const daysRemaining = Math.max(0, windowDays - daysSince);

  if (daysSince > windowDays) {
    return buildResult(
      {
        status: "WINDOW_EXPIRED",
        check_status: "WINDOW_EXPIRED",
        evaluated_at: evaluatedAt,
        days_since_purchase: daysSince,
        days_remaining: 0,
        purchase_price: input.purchase_price ?? undefined,
        currency: input.currency === "USD" ? "USD" : undefined,
        reasons: ["window_expired", `days_since_purchase=${daysSince}`],
      },
      policy,
    );
  }

  // --- Evidence: receipt / packing slip ---
  if (input.has_receipt_or_packing_slip === false) {
    return buildResult(
      {
        status: "MATCH_REVIEW_REQUIRED",
        check_status: "MATCH_REVIEW_REQUIRED",
        evaluated_at: evaluatedAt,
        days_since_purchase: daysSince,
        days_remaining: daysRemaining,
        purchase_price: input.purchase_price ?? undefined,
        currency: input.currency === "USD" ? "USD" : undefined,
        reasons: ["missing_receipt_or_packing_slip"],
      },
      policy,
    );
  }

  // --- Locked match ---
  if (input.has_locked_fingerprint !== true) {
    return buildResult(
      {
        status: "MATCH_REVIEW_REQUIRED",
        check_status: "MATCH_REVIEW_REQUIRED",
        evaluated_at: evaluatedAt,
        days_since_purchase: daysSince,
        days_remaining: daysRemaining,
        purchase_price: input.purchase_price ?? undefined,
        currency: input.currency === "USD" ? "USD" : undefined,
        reasons: ["no_locked_exact_match"],
      },
      policy,
    );
  }

  // --- Purchase price presence ---
  if (
    input.purchase_price === null ||
    input.purchase_price === undefined ||
    !(input.purchase_price > 0)
  ) {
    return buildResult(
      {
        status: "UNSUPPORTED_PURCHASE",
        check_status: "UNSUPPORTED_PURCHASE",
        evaluated_at: evaluatedAt,
        days_since_purchase: daysSince,
        days_remaining: daysRemaining,
        reasons: ["missing_or_invalid_purchase_price"],
      },
      policy,
    );
  }

  if (input.currency !== "USD") {
    return buildResult(
      {
        status: "UNSUPPORTED_PURCHASE",
        check_status: "UNSUPPORTED_PURCHASE",
        evaluated_at: evaluatedAt,
        days_since_purchase: daysSince,
        days_remaining: daysRemaining,
        reasons: ["unsupported_currency"],
      },
      policy,
    );
  }

  // --- Reliable observed price ---
  const observed = input.observed_target_price;
  const reliable = input.observed_price_reliable !== false;
  if (
    observed === null ||
    observed === undefined ||
    !(observed > 0) ||
    !reliable
  ) {
    return buildResult(
      {
        status: "NO_RELIABLE_PRICE",
        check_status: "NO_RELIABLE_PRICE",
        evaluated_at: evaluatedAt,
        days_since_purchase: daysSince,
        days_remaining: daysRemaining,
        purchase_price: input.purchase_price,
        currency: "USD",
        reasons: ["no_reliable_current_target_price"],
      },
      policy,
    );
  }

  if (input.observed_currency && input.observed_currency !== "USD") {
    return buildResult(
      {
        status: "NO_RELIABLE_PRICE",
        check_status: "NO_RELIABLE_PRICE",
        evaluated_at: evaluatedAt,
        days_since_purchase: daysSince,
        days_remaining: daysRemaining,
        purchase_price: input.purchase_price,
        currency: "USD",
        reasons: ["observed_currency_mismatch"],
      },
      policy,
    );
  }

  // --- Price drop ---
  if (observed >= input.purchase_price) {
    return buildResult(
      {
        status: "NO_PRICE_DROP",
        check_status: "NO_PRICE_DROP",
        evaluated_at: evaluatedAt,
        days_since_purchase: daysSince,
        days_remaining: daysRemaining,
        purchase_price: input.purchase_price,
        observed_target_price: observed,
        potential_recovery: 0,
        currency: "USD",
        reasons: ["observed_price_not_lower"],
      },
      policy,
    );
  }

  const recovery =
    Math.round((input.purchase_price - observed) * 100) / 100;

  // Positive path: price drop detected; language remains potentially eligible only.
  return buildResult(
    {
      status: "PRICE_DROP_DETECTED",
      check_status: "POTENTIALLY_ELIGIBLE",
      evaluated_at: evaluatedAt,
      days_since_purchase: daysSince,
      days_remaining: daysRemaining,
      purchase_price: input.purchase_price,
      observed_target_price: observed,
      potential_recovery: recovery,
      currency: "USD",
      reasons: [
        "lower_observed_target_price",
        "target_makes_final_decision",
      ],
    },
    policy,
  );
}

/** Map ResultStatus used only for type export convenience in tests. */
export type { ResultStatus };
