import { z } from "zod";
import {
  CurrencyCodeSchema,
  ProviderStatusSchema,
  SellerKindSchema,
} from "./enums.js";
import {
  IsoDateTimeSchema,
  NonEmptyStringSchema,
  PositiveMoneySchema,
} from "./common.js";
import { EvidenceProvenanceSchema } from "./evidence-provenance.js";

/**
 * Normalized price observation from third-party search.
 * Does not decide Target eligibility (connector boundary).
 */
export const PriceObservationSchema = z
  .object({
    observation_id: NonEmptyStringSchema,
    purchase_id: NonEmptyStringSchema.optional(),
    fingerprint_id: NonEmptyStringSchema.optional(),
    provider_status: ProviderStatusSchema,
    seller_kind: SellerKindSchema,
    seller_text: NonEmptyStringSchema,
    product_title: NonEmptyStringSchema,
    product_url: z.string().url().optional(),
    target_item_id: NonEmptyStringSchema.optional(),
    model_number: NonEmptyStringSchema.optional(),
    upc_or_gtin: NonEmptyStringSchema.optional(),
    observed_price: PositiveMoneySchema.optional(),
    currency: CurrencyCodeSchema.optional(),
    observed_at: IsoDateTimeSchema,
    is_target_plus: z.boolean().default(false),
    provenance: EvidenceProvenanceSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.provider_status === "LIVE_TARGET_MATCH" ||
      value.provider_status === "TARGET_CANDIDATE_REVIEW"
    ) {
      if (value.observed_price === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "positive provider statuses require observed_price",
          path: ["observed_price"],
        });
      }
      if (value.currency === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "positive provider statuses require currency",
          path: ["currency"],
        });
      }
    }
  });

export type PriceObservation = z.infer<typeof PriceObservationSchema>;

export function parsePriceObservation(input: unknown): PriceObservation {
  return PriceObservationSchema.parse(input);
}

export function safeParsePriceObservation(input: unknown) {
  return PriceObservationSchema.safeParse(input);
}
