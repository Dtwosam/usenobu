import { z } from "zod";
import {
  CountryCodeSchema,
  PriceProviderSchema,
  PriceSourceType,
  PriceSourceTypeSchema,
  SearchEngineSchema,
} from "./enums.js";
import {
  IsoDateTimeSchema,
  NonEmptyStringSchema,
  Sha256HexSchema,
} from "./common.js";

/**
 * Mandatory price provenance (retailer/price-source governance).
 * SerpApi observations are THIRD_PARTY_SEARCH_OBSERVATION only.
 */
export const EvidenceProvenanceSchema = z
  .object({
    price_source_type: PriceSourceTypeSchema,
    provider: PriceProviderSchema.optional(),
    engine: SearchEngineSchema.optional(),
    query: NonEmptyStringSchema.optional(),
    fingerprint_id: NonEmptyStringSchema.optional(),
    location: NonEmptyStringSchema.optional(),
    country: CountryCodeSchema.optional(),
    language: z.string().min(2).max(10).optional(),
    device: z.string().min(1).max(32).optional(),
    observed_at: IsoDateTimeSchema,
    raw_result_hash: Sha256HexSchema.optional(),
    matching_rule_version: NonEmptyStringSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.price_source_type ===
      PriceSourceType.THIRD_PARTY_SEARCH_OBSERVATION
    ) {
      if (value.provider !== "SerpApi") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "third-party search observations must record provider SerpApi",
          path: ["provider"],
        });
      }
      if (value.engine !== "google_shopping") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "third-party search observations must record engine google_shopping",
          path: ["engine"],
        });
      }
      if (!value.raw_result_hash) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "third-party search observations require raw_result_hash for audit",
          path: ["raw_result_hash"],
        });
      }
    }
  });

export type EvidenceProvenance = z.infer<typeof EvidenceProvenanceSchema>;

export function parseEvidenceProvenance(input: unknown): EvidenceProvenance {
  return EvidenceProvenanceSchema.parse(input);
}

export function safeParseEvidenceProvenance(input: unknown) {
  return EvidenceProvenanceSchema.safeParse(input);
}
