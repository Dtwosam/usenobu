import { z } from "zod";
import {
  CheckResultStatusSchema,
  CurrencyCodeSchema,
  FinalDecisionBy,
  FinalDecisionBySchema,
  POLICY_ID_TARGET_US_V1,
  PriceSourceType,
  PriceSourceTypeSchema,
  ResultStatusSchema,
} from "./enums.js";
import {
  IsoDateTimeSchema,
  NonEmptyStringSchema,
  NonNegativeMoneySchema,
  PositiveMoneySchema,
} from "./common.js";

/**
 * Deterministic Target policy result contract (shape only — no engine logic in Lane 1).
 * Always binds policy_id/version and states Target makes the final decision.
 */
export const TargetPolicyResultSchema = z
  .object({
    status: ResultStatusSchema,
    check_status: CheckResultStatusSchema.optional(),
    policy_id: z.literal(POLICY_ID_TARGET_US_V1),
    policy_version: NonEmptyStringSchema,
    policy_verified_at: IsoDateTimeSchema,
    purchase_price: PositiveMoneySchema.optional(),
    observed_target_price: PositiveMoneySchema.optional(),
    potential_recovery: NonNegativeMoneySchema.optional(),
    currency: CurrencyCodeSchema.optional(),
    days_since_purchase: z.number().int().min(0).optional(),
    days_remaining: z.number().int().min(0).max(14).optional(),
    price_source_type: z.literal(
      PriceSourceType.THIRD_PARTY_SEARCH_OBSERVATION,
    ),
    final_decision_by: z.literal(FinalDecisionBy.TARGET),
    disclaimer: NonEmptyStringSchema,
    reasons: z.array(NonEmptyStringSchema).default([]),
    evaluated_at: IsoDateTimeSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.status === "PRICE_DROP_DETECTED" ||
      value.status === "POTENTIALLY_ELIGIBLE"
    ) {
      if (value.observed_target_price === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "positive eligibility requires observed_target_price",
          path: ["observed_target_price"],
        });
      }
      if (value.purchase_price === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "positive eligibility requires purchase_price",
          path: ["purchase_price"],
        });
      }
      if (value.potential_recovery === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "positive eligibility requires potential_recovery",
          path: ["potential_recovery"],
        });
      }
    }
    const lower = value.disclaimer.toLowerCase();
    if (
      lower.includes("guaranteed refund") ||
      lower.includes("official target api")
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "disclaimer must not use forbidden guarantee language",
        path: ["disclaimer"],
      });
    }
  });

export type TargetPolicyResult = z.infer<typeof TargetPolicyResultSchema>;

export function parseTargetPolicyResult(input: unknown): TargetPolicyResult {
  return TargetPolicyResultSchema.parse(input);
}

export function safeParseTargetPolicyResult(input: unknown) {
  return TargetPolicyResultSchema.safeParse(input);
}

export {
  CheckResultStatusSchema,
  FinalDecisionBySchema,
  PriceSourceTypeSchema,
  ResultStatusSchema,
};
