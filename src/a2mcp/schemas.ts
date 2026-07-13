import { z } from "zod";
import {
  IsoDateSchema,
  NonEmptyStringSchema,
  PositiveMoneySchema,
  TargetProductUrlSchema,
  UsRegionCodeSchema,
} from "../domain/common.js";
import { POLICY_ID_TARGET_US_V1 } from "../domain/enums.js";

/**
 * OpenAPI TargetPriceCheckRequest — strict (rejects password/card/unknown fields).
 */
export const A2mcpRequestSchema = z
  .object({
    target_product_url: TargetProductUrlSchema,
    purchase_price: PositiveMoneySchema,
    currency: z.literal("USD"),
    purchase_date: IsoDateSchema,
    country: z.literal("US"),
    region: UsRegionCodeSchema.optional(),
    purchase_channel: z.literal("target_online"),
    model_number: NonEmptyStringSchema.optional(),
    upc_or_gtin: NonEmptyStringSchema.optional(),
    target_item_id: NonEmptyStringSchema.optional(),
    user_confirmed_match_id: NonEmptyStringSchema.optional(),
  })
  .strict();

export type A2mcpRequest = z.infer<typeof A2mcpRequestSchema>;

export const A2mcpStatusSchema = z.enum([
  "PRICE_DROP_DETECTED",
  "POTENTIALLY_ELIGIBLE",
  "NO_PRICE_DROP",
  "WINDOW_EXPIRED",
  "MATCH_REVIEW_REQUIRED",
  "NO_RELIABLE_PRICE",
  "POLICY_EXCLUSION",
  "UNSUPPORTED_PURCHASE",
  "POLICY_STALE",
  "DATA_SOURCE_UNAVAILABLE",
]);

export type A2mcpStatus = z.infer<typeof A2mcpStatusSchema>;

/** OpenAPI TargetPriceCheckResponse required + optional fields. */
export const A2mcpResponseSchema = z
  .object({
    status: A2mcpStatusSchema,
    policy_id: z.literal(POLICY_ID_TARGET_US_V1),
    price_source_type: z.literal("THIRD_PARTY_SEARCH_OBSERVATION"),
    final_decision_by: z.literal("Target"),
    checked_at: z.string().datetime({ offset: true }),
    purchase_price: z.number().optional(),
    observed_target_price: z.number().optional(),
    potential_recovery: z.number().optional(),
    currency: z.string().optional(),
    days_remaining: z.number().int().optional(),
    matched_product: z.record(z.unknown()).optional(),
    provider: z.literal("SerpApi").optional(),
    official_next_action: z
      .object({
        online_chat: z.boolean().optional(),
        guest_services_phone: z.string().optional(),
      })
      .optional(),
    disclaimer: z.string().optional(),
  })
  .strict();

export type A2mcpResponse = z.infer<typeof A2mcpResponseSchema>;

export function safeParseA2mcpRequest(input: unknown) {
  return A2mcpRequestSchema.safeParse(input);
}
