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
  toUtcCalendarDateString,
} from "./dates.js";
import {
  DEFAULT_POLICY_DISCLAIMER,
  TARGET_US_POLICY,
  type TargetUsPolicy,
} from "./target-us-policy.js";
import {
  PolicyReviewState,
  resolvePolicyRuntime,
  type PolicyOperationsRecord,
  type PolicyRuntimeView,
} from "./operations/index.js";
import { buildDefaultPolicyOperationsRecord } from "./operations/seed.js";

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
   * Force unusable/retired policy path (fixture/tests).
   * Ordinary overdue review is CHECK_DUE, not POLICY_STALE.
   */
  force_policy_stale?: boolean;
  /** Inject ops record for tests / runtime (preferred over age-only gates). */
  policy_operations?: PolicyOperationsRecord;
  /** Inject pre-resolved runtime view. */
  policy_runtime?: PolicyRuntimeView;
}

export interface EvaluateTargetPolicyOptions {
  policy?: TargetUsPolicy;
  /**
   * Skip ops/review gates for unit fixtures that only test channel/window/match rules.
   * Does not invent policy freshness success in production callers.
   */
  skip_freshness_check?: boolean;
}

export interface TargetPolicyEvaluationExtras {
  policy_runtime?: PolicyRuntimeView;
  policy_warning?: string | null;
  eligibility_suppressed?: boolean;
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
  ops?: PolicyOperationsRecord,
): TargetPolicyResult {
  return parseTargetPolicyResult({
    ...partial,
    policy_id: policy.policy_id,
    policy_version: policy.policy_version,
    policy_verified_at: ops?.source_last_checked_at ?? policy.verified_at,
    price_source_type: PriceSourceType.THIRD_PARTY_SEARCH_OBSERVATION,
    final_decision_by: FinalDecisionBy.TARGET,
    disclaimer: partial.disclaimer ?? DEFAULT_POLICY_DISCLAIMER,
  });
}

function resolveRuntimeForEvaluation(
  input: TargetPolicyEvaluationInput,
  policy: TargetUsPolicy,
  evaluatedAt: string,
): PolicyRuntimeView {
  if (input.policy_runtime) return input.policy_runtime;

  if (input.force_policy_stale === true) {
    const base = input.policy_operations ?? buildDefaultPolicyOperationsRecord(evaluatedAt);
    const retired: PolicyOperationsRecord = {
      ...base,
      review_state: PolicyReviewState.RETIRED,
      retired_at: evaluatedAt,
      updated_at: evaluatedAt,
    };
    return resolvePolicyRuntime(retired, evaluatedAt, {
      review_interval_hours: policy.review_interval_hours,
      source_unavailable_grace_hours: policy.source_unavailable_grace_hours,
    });
  }

  const record =
    input.policy_operations ?? buildDefaultPolicyOperationsRecord(evaluatedAt);
  return resolvePolicyRuntime(record, evaluatedAt, {
    review_interval_hours: policy.review_interval_hours,
    source_unavailable_grace_hours: policy.source_unavailable_grace_hours,
  });
}

/**
 * Deterministic Target policy evaluation (Lane 2 + 8-R1A ops).
 * Does not call SerpApi, does not match products, does not guarantee refunds.
 *
 * Policy ops: overdue review → CHECK_DUE (continue with warning), not POLICY_STALE.
 * POLICY_STALE is reserved for retired / unusable / grace-expired source states.
 */
export function evaluateTargetPolicy(
  input: TargetPolicyEvaluationInput,
  options: EvaluateTargetPolicyOptions = {},
): TargetPolicyResult & TargetPolicyEvaluationExtras {
  const policy = options.policy ?? TARGET_US_POLICY;
  const evaluatedAt = input.evaluated_at ?? new Date().toISOString();

  const runtime = options.skip_freshness_check
    ? undefined
    : resolveRuntimeForEvaluation(input, policy, evaluatedAt);

  const opsRecord = runtime?.record;

  // --- Unusable / retired / grace-expired (POLICY_STALE only here) ---
  if (runtime?.block_positive_service) {
    const reason =
      runtime.effective_state === PolicyReviewState.RETIRED
        ? "policy_retired"
        : runtime.effective_state === PolicyReviewState.SOURCE_UNAVAILABLE
          ? "policy_source_unavailable_grace_expired"
          : "policy_unusable";
    return {
      ...buildResult(
        {
          status: "POLICY_STALE",
          check_status: "POLICY_STALE",
          evaluated_at: evaluatedAt,
          reasons: [reason],
          purchase_price: input.purchase_price ?? undefined,
          currency: input.currency === "USD" ? "USD" : undefined,
          disclaimer: runtime.warning
            ? `${DEFAULT_POLICY_DISCLAIMER} ${runtime.warning}`
            : DEFAULT_POLICY_DISCLAIMER,
        },
        policy,
        opsRecord,
      ),
      policy_runtime: runtime,
      policy_warning: runtime.warning,
      eligibility_suppressed: true,
    };
  }

  // --- Channel ---
  const channel = (input.purchase_channel ?? "").trim().toLowerCase();
  if (!channel) {
    return {
      ...buildResult(
        {
          status: "UNSUPPORTED_PURCHASE",
          check_status: "UNSUPPORTED_PURCHASE",
          evaluated_at: evaluatedAt,
          reasons: ["missing_purchase_channel"],
        },
        policy,
        opsRecord,
      ),
      policy_runtime: runtime,
      policy_warning: runtime?.warning ?? null,
    };
  }
  if (channel !== "target_online" && channel !== "online") {
    return {
      ...buildResult(
        {
          status: "UNSUPPORTED_PURCHASE",
          check_status: "UNSUPPORTED_PURCHASE",
          evaluated_at: evaluatedAt,
          reasons: ["unsupported_purchase_channel", channel],
        },
        policy,
        opsRecord,
      ),
      policy_runtime: runtime,
      policy_warning: runtime?.warning ?? null,
    };
  }

  // --- Geography ---
  const country = (input.country ?? "").trim().toUpperCase();
  if (!country) {
    return {
      ...buildResult(
        {
          status: "UNSUPPORTED_PURCHASE",
          check_status: "UNSUPPORTED_PURCHASE",
          evaluated_at: evaluatedAt,
          reasons: ["missing_country"],
        },
        policy,
        opsRecord,
      ),
      policy_runtime: runtime,
      policy_warning: runtime?.warning ?? null,
    };
  }
  if (country !== "US") {
    return {
      ...buildResult(
        {
          status: "UNSUPPORTED_PURCHASE",
          check_status: "UNSUPPORTED_PURCHASE",
          evaluated_at: evaluatedAt,
          reasons: ["unsupported_country", country],
        },
        policy,
        opsRecord,
      ),
      policy_runtime: runtime,
      policy_warning: runtime?.warning ?? null,
    };
  }

  const region = input.region?.trim().toUpperCase();
  if (
    region &&
    (policy.unsupported_regions as readonly string[]).includes(region)
  ) {
    return {
      ...buildResult(
        {
          status: "UNSUPPORTED_PURCHASE",
          check_status: "UNSUPPORTED_PURCHASE",
          evaluated_at: evaluatedAt,
          reasons: ["unsupported_region", region],
        },
        policy,
        opsRecord,
      ),
      policy_runtime: runtime,
      policy_warning: runtime?.warning ?? null,
    };
  }

  // --- Known exclusions / Target Plus ---
  if (input.is_target_plus === true) {
    return {
      ...buildResult(
        {
          status: "POLICY_EXCLUSION",
          check_status: "POLICY_EXCLUSION",
          evaluated_at: evaluatedAt,
          reasons: ["target_plus_excluded"],
          purchase_price: input.purchase_price ?? undefined,
          currency: input.currency === "USD" ? "USD" : undefined,
        },
        policy,
        opsRecord,
      ),
      policy_runtime: runtime,
      policy_warning: runtime?.warning ?? null,
    };
  }

  if (input.known_exclusion && input.known_exclusion.trim()) {
    if (isKnownExcludedCategory(input.known_exclusion, policy)) {
      return {
        ...buildResult(
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
          opsRecord,
        ),
        policy_runtime: runtime,
        policy_warning: runtime?.warning ?? null,
      };
    }
    // Unknown exclusion labels fail closed — do not invent support.
    return {
      ...buildResult(
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
        opsRecord,
      ),
      policy_runtime: runtime,
      policy_warning: runtime?.warning ?? null,
    };
  }

  // --- Purchase date / window ---
  if (!input.purchase_date || !String(input.purchase_date).trim()) {
    return {
      ...buildResult(
        {
          status: "UNSUPPORTED_PURCHASE",
          check_status: "UNSUPPORTED_PURCHASE",
          evaluated_at: evaluatedAt,
          reasons: ["missing_purchase_date"],
        },
        policy,
        opsRecord,
      ),
      policy_runtime: runtime,
      policy_warning: runtime?.warning ?? null,
    };
  }

  const purchaseDate = toUtcCalendarDateString(input.purchase_date);
  if (!purchaseDate) {
    return {
      ...buildResult(
        {
          status: "UNSUPPORTED_PURCHASE",
          check_status: "UNSUPPORTED_PURCHASE",
          evaluated_at: evaluatedAt,
          reasons: ["invalid_purchase_date"],
        },
        policy,
        opsRecord,
      ),
      policy_runtime: runtime,
      policy_warning: runtime?.warning ?? null,
    };
  }

  const daysSince = calendarDaysSincePurchase(purchaseDate, evaluatedAt);
  if (daysSince === null) {
    return {
      ...buildResult(
        {
          status: "UNSUPPORTED_PURCHASE",
          check_status: "UNSUPPORTED_PURCHASE",
          evaluated_at: evaluatedAt,
          reasons: ["uncomputable_policy_window"],
        },
        policy,
        opsRecord,
      ),
      policy_runtime: runtime,
      policy_warning: runtime?.warning ?? null,
    };
  }

  if (daysSince < 0) {
    return {
      ...buildResult(
        {
          status: "UNSUPPORTED_PURCHASE",
          check_status: "UNSUPPORTED_PURCHASE",
          evaluated_at: evaluatedAt,
          reasons: ["future_purchase_date"],
        },
        policy,
        opsRecord,
      ),
      policy_runtime: runtime,
      policy_warning: runtime?.warning ?? null,
    };
  }

  const windowDays = policy.window.days;
  const daysRemaining = Math.max(0, windowDays - daysSince);

  if (daysSince > windowDays) {
    return {
      ...buildResult(
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
        opsRecord,
      ),
      policy_runtime: runtime,
      policy_warning: runtime?.warning ?? null,
    };
  }

  // --- Evidence: receipt / packing slip ---
  if (input.has_receipt_or_packing_slip === false) {
    return {
      ...buildResult(
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
        opsRecord,
      ),
      policy_runtime: runtime,
      policy_warning: runtime?.warning ?? null,
    };
  }

  // --- Locked match ---
  if (input.has_locked_fingerprint !== true) {
    return {
      ...buildResult(
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
        opsRecord,
      ),
      policy_runtime: runtime,
      policy_warning: runtime?.warning ?? null,
    };
  }

  // --- Purchase price presence ---
  if (
    input.purchase_price === null ||
    input.purchase_price === undefined ||
    !(input.purchase_price > 0)
  ) {
    return {
      ...buildResult(
        {
          status: "UNSUPPORTED_PURCHASE",
          check_status: "UNSUPPORTED_PURCHASE",
          evaluated_at: evaluatedAt,
          days_since_purchase: daysSince,
          days_remaining: daysRemaining,
          reasons: ["missing_or_invalid_purchase_price"],
        },
        policy,
        opsRecord,
      ),
      policy_runtime: runtime,
      policy_warning: runtime?.warning ?? null,
    };
  }

  if (input.currency !== "USD") {
    return {
      ...buildResult(
        {
          status: "UNSUPPORTED_PURCHASE",
          check_status: "UNSUPPORTED_PURCHASE",
          evaluated_at: evaluatedAt,
          days_since_purchase: daysSince,
          days_remaining: daysRemaining,
          reasons: ["unsupported_currency"],
        },
        policy,
        opsRecord,
      ),
      policy_runtime: runtime,
      policy_warning: runtime?.warning ?? null,
    };
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
    return {
      ...buildResult(
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
        opsRecord,
      ),
      policy_runtime: runtime,
      policy_warning: runtime?.warning ?? null,
    };
  }

  if (input.observed_currency && input.observed_currency !== "USD") {
    return {
      ...buildResult(
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
        opsRecord,
      ),
      policy_runtime: runtime,
      policy_warning: runtime?.warning ?? null,
    };
  }

  // --- Price drop ---
  if (observed >= input.purchase_price) {
    return {
      ...buildResult(
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
        opsRecord,
      ),
      policy_runtime: runtime,
      policy_warning: runtime?.warning ?? null,
    };
  }

  const recovery =
    Math.round((input.purchase_price - observed) * 100) / 100;

  // Factual price drop under CHANGE_DETECTED / REVIEW_REQUIRED:
  // keep observed prices; do not issue POTENTIALLY_ELIGIBLE / positive eligibility.
  if (runtime?.suppress_positive_eligibility) {
    return {
      ...buildResult(
        {
          status: "PRICE_DROP_DETECTED",
          // Omit POTENTIALLY_ELIGIBLE — Target remains final decision-maker.
          evaluated_at: evaluatedAt,
          days_since_purchase: daysSince,
          days_remaining: daysRemaining,
          purchase_price: input.purchase_price,
          observed_target_price: observed,
          potential_recovery: recovery,
          currency: "USD",
          reasons: [
            "lower_observed_target_price",
            "policy_eligibility_suppressed_pending_review",
            "target_makes_final_decision",
          ],
          disclaimer: runtime.warning
            ? `${DEFAULT_POLICY_DISCLAIMER} ${runtime.warning}`
            : DEFAULT_POLICY_DISCLAIMER,
        },
        policy,
        opsRecord,
      ),
      policy_runtime: runtime,
      policy_warning: runtime.warning,
      eligibility_suppressed: true,
    };
  }

  // Positive path: price drop detected; language remains potentially eligible only.
  const warningSuffix = runtime?.warning ? ` ${runtime.warning}` : "";
  return {
    ...buildResult(
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
          ...(runtime?.effective_state === PolicyReviewState.CHECK_DUE
            ? ["policy_review_check_due"]
            : []),
          ...(runtime?.effective_state === PolicyReviewState.SOURCE_UNAVAILABLE
            ? ["policy_source_unavailable_in_grace"]
            : []),
        ],
        disclaimer: `${DEFAULT_POLICY_DISCLAIMER}${warningSuffix}`,
      },
      policy,
      opsRecord,
    ),
    policy_runtime: runtime,
    policy_warning: runtime?.warning ?? null,
    eligibility_suppressed: false,
  };
}

/** Map ResultStatus used only for type export convenience in tests. */
export type { ResultStatus };
