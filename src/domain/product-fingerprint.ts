import { z } from "zod";
import { SellerKind, SellerKindSchema } from "./enums.js";
import {
  IsoDateTimeSchema,
  NonEmptyStringSchema,
  TargetProductUrlSchema,
} from "./common.js";

/**
 * Locked product fingerprint after one-time user confirmation.
 * Incomplete fingerprints fail closed — at least one strong identifier is required.
 * Seller must be Target; Target Plus cannot be locked.
 */
export const LockedProductFingerprintSchema = z
  .object({
    fingerprint_id: NonEmptyStringSchema,
    purchase_id: NonEmptyStringSchema.optional(),
    target_product_url: TargetProductUrlSchema,
    target_item_id: NonEmptyStringSchema.optional(),
    model_number: NonEmptyStringSchema.optional(),
    upc_or_gtin: NonEmptyStringSchema.optional(),
    brand: NonEmptyStringSchema.optional(),
    size: NonEmptyStringSchema.optional(),
    color: NonEmptyStringSchema.optional(),
    weight: NonEmptyStringSchema.optional(),
    quantity: NonEmptyStringSchema.optional(),
    product_title: NonEmptyStringSchema.optional(),
    seller_kind: z.literal(SellerKind.TARGET),
    is_target_plus: z.literal(false),
    confirmed_at: IsoDateTimeSchema,
    confirmed_by_user: z.literal(true),
  })
  .strict()
  .superRefine((value, ctx) => {
    const hasStrongId = Boolean(
      value.target_item_id || value.model_number || value.upc_or_gtin,
    );
    if (!hasStrongId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "locked fingerprint requires target_item_id, model_number, or upc_or_gtin",
        path: ["target_item_id"],
      });
    }
  });

export type LockedProductFingerprint = z.infer<
  typeof LockedProductFingerprintSchema
>;

export function parseLockedProductFingerprint(
  input: unknown,
): LockedProductFingerprint {
  return LockedProductFingerprintSchema.parse(input);
}

export function safeParseLockedProductFingerprint(input: unknown) {
  return LockedProductFingerprintSchema.safeParse(input);
}

/** Runtime guard for incomplete identity sets used by tests and future matching. */
export function isCompleteFingerprintIdentity(input: {
  target_item_id?: string | undefined;
  model_number?: string | undefined;
  upc_or_gtin?: string | undefined;
}): boolean {
  return Boolean(
    input.target_item_id || input.model_number || input.upc_or_gtin,
  );
}

export { SellerKindSchema };
