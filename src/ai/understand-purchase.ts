import {
  computeMissingFields,
  ExtractedPurchaseSchema,
  type ExtractedPurchase,
  type FieldEvidence,
  type UnderstandPurchaseResponse,
  UnderstandPurchaseResponseSchema,
  MAX_PURCHASE_TEXT_LENGTH,
  PurchaseTextSchema,
} from "./schemas.js";
import { deterministicExtract } from "./deterministic-extract.js";
import {
  isXaiConfigured,
  xaiExtractPurchase,
  type XaiExtractResult,
} from "./xai-client.js";
import {
  auditExtractEvent,
  detectSensitive,
  hashPurchaseText,
  stripInjectionAttempts,
} from "./sanitize.js";
import { toIsoDate } from "./dates.js";

export type UnderstandDeps = {
  /** Inject LLM for tests. */
  llm?: (args: {
    purchaseText: string;
    serverToday: string;
  }) => Promise<XaiExtractResult>;
  /** Force deterministic path even if key present. */
  forceDeterministic?: boolean;
  /** Force unavailable. */
  forceUnavailable?: boolean;
  now?: () => Date;
};

function normalizeFromLlm(raw: {
  retailer: string | null;
  product_description: string | null;
  product_url: string | null;
  purchase_price: number | null;
  currency: string | null;
  purchase_date: string | null;
  purchase_channel: string | null;
  region: string | null;
  model_number: string | null;
  target_item_id: string | null;
  upc_or_gtin: string | null;
}): ExtractedPurchase {
  return ExtractedPurchaseSchema.parse({
    retailer: raw.retailer,
    product_description: raw.product_description,
    product_url: raw.product_url,
    purchase_price:
      raw.purchase_price != null && raw.purchase_price > 0
        ? raw.purchase_price
        : null,
    currency: raw.currency === "USD" ? "USD" : null,
    purchase_date: raw.purchase_date,
    purchase_channel:
      raw.purchase_channel === "target_online" ? "target_online" : null,
    region: raw.region,
    model_number: raw.model_number,
    target_item_id: raw.target_item_id,
    upc_or_gtin: raw.upc_or_gtin,
  });
}

export type UnderstandResult =
  | { ok: true; body: UnderstandPurchaseResponse }
  | {
      ok: false;
      error:
        | "invalid_input"
        | "ai_unavailable"
        | "timeout"
        | "sensitive_data"
        | "provider_error"
        | "refusal";
      message: string;
      http_status: 400 | 503;
    };

/**
 * UNDERSTAND_PURCHASE — extraction only.
 * Never runs matching, policy, or monitoring.
 */
export async function understandPurchase(
  purchaseTextRaw: unknown,
  deps: UnderstandDeps = {},
): Promise<UnderstandResult> {
  const started = Date.now();
  const parsedText = PurchaseTextSchema.safeParse(purchaseTextRaw);
  if (!parsedText.success) {
    return {
      ok: false,
      error: "invalid_input",
      message: "Purchase text is required and must be under 2000 characters.",
      http_status: 400,
    };
  }

  const text = parsedText.data;
  if (text.length > MAX_PURCHASE_TEXT_LENGTH) {
    return {
      ok: false,
      error: "invalid_input",
      message: "Purchase text is too long.",
      http_status: 400,
    };
  }

  const sensitive = detectSensitive(text);
  if (sensitive.sensitive) {
    const hash = await hashPurchaseText(text);
    auditExtractEvent({
      outcome: "sensitive_rejected",
      text_hash: hash,
      text_length: text.length,
      duration_ms: Date.now() - started,
    });
    return {
      ok: false,
      error: "sensitive_data",
      message:
        "That text appears to include sensitive information (for example a card, password, or 2FA code). Remove it and try again, or enter details manually.",
      http_status: 400,
    };
  }

  const cleaned = stripInjectionAttempts(text);
  const today = deps.now?.() ?? new Date();
  const serverToday = toIsoDate(today);
  const hash = await hashPurchaseText(text);

  if (deps.forceUnavailable) {
    auditExtractEvent({
      outcome: "unavailable",
      text_hash: hash,
      text_length: text.length,
      duration_ms: Date.now() - started,
    });
    return {
      ok: false,
      error: "ai_unavailable",
      message:
        "AI assistance is temporarily unavailable. You can still enter the purchase details manually.",
      http_status: 503,
    };
  }

  let extracted: ExtractedPurchase;
  let uncertain: string[] = [];
  let field_evidence: FieldEvidence[] = [];
  let provider: "xai" | "deterministic" = "deterministic";

  const tryLlm =
    !deps.forceDeterministic && (deps.llm != null || isXaiConfigured());

  if (tryLlm) {
    const llm =
      deps.llm ??
      ((a: { purchaseText: string; serverToday: string }) =>
        xaiExtractPurchase({
          purchaseText: a.purchaseText,
          serverToday: a.serverToday,
        }));

    const llmResult = await llm({
      purchaseText: cleaned,
      serverToday,
    });

    if (llmResult.ok) {
      if (llmResult.output.contains_sensitive_data) {
        auditExtractEvent({
          outcome: "sensitive_from_model",
          provider: "xai",
          text_hash: hash,
          text_length: text.length,
          duration_ms: Date.now() - started,
        });
        return {
          ok: false,
          error: "sensitive_data",
          message:
            "That text appears to include sensitive information. Remove it and try again, or enter details manually.",
          http_status: 400,
        };
      }
      extracted = normalizeFromLlm(llmResult.output);
      uncertain = llmResult.output.uncertain_fields ?? [];
      field_evidence = llmResult.output.field_evidence ?? [];
      provider = "xai";
    } else if (llmResult.error === "timeout") {
      auditExtractEvent({
        outcome: "timeout",
        provider: "xai",
        text_hash: hash,
        text_length: text.length,
        duration_ms: Date.now() - started,
      });
      return {
        ok: false,
        error: "timeout",
        message:
          "AI assistance is temporarily unavailable. You can still enter the purchase details manually.",
        http_status: 503,
      };
    } else if (llmResult.error === "refusal") {
      auditExtractEvent({
        outcome: "refusal",
        provider: "xai",
        text_hash: hash,
        text_length: text.length,
        duration_ms: Date.now() - started,
      });
      return {
        ok: false,
        error: "refusal",
        message:
          "AI could not process that description. Please enter the purchase details manually.",
        http_status: 400,
      };
    } else {
      // missing_api_key | invalid_output | provider_error → deterministic fallback
      auditExtractEvent({
        outcome: `llm_${llmResult.error}_fallback`,
        provider: "xai",
        text_hash: hash,
        text_length: text.length,
        duration_ms: Date.now() - started,
      });
      const det = deterministicExtract(cleaned, today);
      extracted = det.extracted;
      uncertain = det.uncertain_fields;
      field_evidence = det.field_evidence;
      provider = "deterministic";
    }
  } else {
    const det = deterministicExtract(cleaned, today);
    extracted = det.extracted;
    uncertain = det.uncertain_fields;
    field_evidence = det.field_evidence;
    provider = "deterministic";
  }

  const missing = computeMissingFields(extracted);
  const body = UnderstandPurchaseResponseSchema.parse({
    agent_state: "CONFIRMATION_REQUIRED",
    message: "Review the details Nobu extracted before continuing.",
    requires_user_action: true,
    next_action: "CONFIRM_PURCHASE_DETAILS",
    extracted_purchase: extracted,
    missing_fields: missing,
    uncertain_fields: [...new Set(uncertain)],
    field_evidence,
    provider,
  });

  auditExtractEvent({
    outcome: "ok",
    provider,
    text_hash: hash,
    text_length: text.length,
    duration_ms: Date.now() - started,
  });

  return { ok: true, body };
}
