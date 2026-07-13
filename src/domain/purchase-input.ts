import { z } from "zod";
import {
  CountryCodeSchema,
  CurrencyCodeSchema,
  PurchaseChannelSchema,
} from "./enums.js";
import {
  IsoDateSchema,
  NonEmptyStringSchema,
  PositiveMoneySchema,
  TargetProductUrlSchema,
  UsRegionCodeSchema,
} from "./common.js";

/**
 * Purchase input contract (OpenAPI TargetPriceCheckRequest + master spec).
 * MVP: Target online, USD, US only. No Target Plus field acceptance as supported channel.
 */
export const PurchaseInputSchema = z
  .object({
    target_product_url: TargetProductUrlSchema,
    purchase_price: PositiveMoneySchema,
    currency: CurrencyCodeSchema,
    purchase_date: IsoDateSchema,
    country: CountryCodeSchema,
    region: UsRegionCodeSchema.optional(),
    purchase_channel: PurchaseChannelSchema,
    model_number: NonEmptyStringSchema.optional(),
    upc_or_gtin: NonEmptyStringSchema.optional(),
    target_item_id: NonEmptyStringSchema.optional(),
    user_confirmed_match_id: NonEmptyStringSchema.optional(),
    /** Explicit exclusion flags when known from user input (policy engine consumes later). */
    is_target_plus: z.boolean().optional().default(false),
    known_exclusion: NonEmptyStringSchema.optional(),
  })
  .strict();

export type PurchaseInput = z.infer<typeof PurchaseInputSchema>;

export function parsePurchaseInput(input: unknown): PurchaseInput {
  return PurchaseInputSchema.parse(input);
}

export function safeParsePurchaseInput(input: unknown) {
  return PurchaseInputSchema.safeParse(input);
}
