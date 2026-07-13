import { z } from "zod";
import {
  CurrencyCodeSchema,
  PriceProviderSchema,
  SearchEngineSchema,
  SellerKindSchema,
} from "./enums.js";
import {
  IsoDateTimeSchema,
  NonEmptyStringSchema,
  PositiveMoneySchema,
} from "./common.js";

/**
 * Target product candidate returned from third-party observation before user confirmation.
 * Not a locked fingerprint. Target Plus and non-Target sellers remain representable for fail-closed review.
 */
export const TargetProductCandidateSchema = z
  .object({
    candidate_id: NonEmptyStringSchema,
    provider: PriceProviderSchema,
    engine: SearchEngineSchema,
    seller_kind: SellerKindSchema,
    seller_text: NonEmptyStringSchema,
    product_title: NonEmptyStringSchema,
    product_url: z.string().url(),
    target_item_id: NonEmptyStringSchema.optional(),
    model_number: NonEmptyStringSchema.optional(),
    upc_or_gtin: NonEmptyStringSchema.optional(),
    brand: NonEmptyStringSchema.optional(),
    size: NonEmptyStringSchema.optional(),
    color: NonEmptyStringSchema.optional(),
    weight: NonEmptyStringSchema.optional(),
    quantity: NonEmptyStringSchema.optional(),
    observed_price: PositiveMoneySchema,
    currency: CurrencyCodeSchema,
    observed_at: IsoDateTimeSchema,
    is_target_plus: z.boolean(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.is_target_plus && value.seller_kind === "target") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Target Plus candidates must use seller_kind target_plus, not target",
        path: ["seller_kind"],
      });
    }
  });

export type TargetProductCandidate = z.infer<
  typeof TargetProductCandidateSchema
>;

export function parseTargetProductCandidate(
  input: unknown,
): TargetProductCandidate {
  return TargetProductCandidateSchema.parse(input);
}

export function safeParseTargetProductCandidate(input: unknown) {
  return TargetProductCandidateSchema.safeParse(input);
}
