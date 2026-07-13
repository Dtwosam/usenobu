import { z } from "zod";

/** Max length for natural-language purchase intake. */
export const MAX_PURCHASE_TEXT_LENGTH = 2_000;

export const PurchaseTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_PURCHASE_TEXT_LENGTH);

/**
 * Extracted fields — all optional/nullable; never invent values.
 * product_description maps to form product_title.
 */
export const ExtractedPurchaseSchema = z
  .object({
    retailer: z.string().nullable(),
    product_description: z.string().nullable(),
    product_url: z.string().nullable(),
    purchase_price: z.number().positive().nullable(),
    currency: z.enum(["USD"]).nullable(),
    purchase_date: z.string().nullable(), // YYYY-MM-DD or null
    purchase_channel: z.enum(["target_online"]).nullable(),
    region: z.string().nullable(),
    model_number: z.string().nullable(),
    target_item_id: z.string().nullable(),
    upc_or_gtin: z.string().nullable(),
  })
  .strict();

export type ExtractedPurchase = z.infer<typeof ExtractedPurchaseSchema>;

export const FieldEvidenceSchema = z.object({
  field: z.string(),
  confidence: z.enum(["high", "medium", "low", "uncertain"]),
  /** Nullable for Groq strict schema (all properties required). */
  evidence: z.string().nullable().optional(),
});

export type FieldEvidence = z.infer<typeof FieldEvidenceSchema>;

/** Strict model output schema for structured extraction. */
export const LlmExtractionOutputSchema = z
  .object({
    retailer: z.string().nullable(),
    product_description: z.string().nullable(),
    product_url: z.string().nullable(),
    purchase_price: z.number().nullable(),
    currency: z.string().nullable(),
    purchase_date: z.string().nullable(),
    purchase_channel: z.string().nullable(),
    region: z.string().nullable(),
    model_number: z.string().nullable(),
    target_item_id: z.string().nullable(),
    upc_or_gtin: z.string().nullable(),
    uncertain_fields: z.array(z.string()).default([]),
    field_evidence: z.array(FieldEvidenceSchema).default([]),
    contains_sensitive_data: z.boolean().default(false),
    sensitive_reason: z.string().nullable().default(null),
  })
  .strict();

export type LlmExtractionOutput = z.infer<typeof LlmExtractionOutputSchema>;

export const UnderstandPurchaseResponseSchema = z
  .object({
    agent_state: z.literal("CONFIRMATION_REQUIRED"),
    message: z.string(),
    requires_user_action: z.literal(true),
    next_action: z.literal("CONFIRM_PURCHASE_DETAILS"),
    extracted_purchase: ExtractedPurchaseSchema,
    missing_fields: z.array(z.string()),
    uncertain_fields: z.array(z.string()),
    field_evidence: z.array(FieldEvidenceSchema).optional(),
    provider: z.enum(["groq", "deterministic", "unavailable"]).optional(),
  })
  .strict();

export type UnderstandPurchaseResponse = z.infer<
  typeof UnderstandPurchaseResponseSchema
>;

export const AgentActionSchema = z.enum([
  "UNDERSTAND_PURCHASE",
  "CHECK_CONFIRMED_PURCHASE",
  "CHECK_MONITORING_STATUS",
]);

export const AgentRequestSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("UNDERSTAND_PURCHASE"),
      purchase_text: PurchaseTextSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("CHECK_CONFIRMED_PURCHASE"),
      // Existing A2MCP structured fields
      target_product_url: z.string(),
      purchase_price: z.number().positive(),
      currency: z.literal("USD"),
      purchase_date: z.string(),
      country: z.literal("US"),
      region: z.string().optional(),
      purchase_channel: z.literal("target_online"),
      model_number: z.string().optional(),
      upc_or_gtin: z.string().optional(),
      target_item_id: z.string().optional(),
      user_confirmed_match_id: z.string().optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("CHECK_MONITORING_STATUS"),
      purchase_id: z.string().min(1),
    })
    .strict(),
]);

export type AgentRequest = z.infer<typeof AgentRequestSchema>;

/** Required fields for continuing to Find my product for Target live path. */
export const REQUIRED_FOR_TARGET = [
  "product_url",
  "purchase_price",
  "purchase_date",
] as const;

export function computeMissingFields(
  extracted: ExtractedPurchase,
): string[] {
  const missing: string[] = [];
  if (!extracted.product_url) missing.push("product_url");
  if (extracted.purchase_price == null) missing.push("purchase_price");
  if (!extracted.purchase_date) missing.push("purchase_date");
  return missing;
}
