/**
 * Fail-closed deterministic NL extraction.
 * Used for tests and when no LLM key is configured.
 * Never invents identifiers that are not present in the text.
 */
import {
  type ExtractedPurchase,
  type FieldEvidence,
  ExtractedPurchaseSchema,
} from "./schemas.js";
import { resolveRelativeDate } from "./dates.js";
import { detectSensitive, stripInjectionAttempts } from "./sanitize.js";

export interface DeterministicExtractResult {
  extracted: ExtractedPurchase;
  uncertain_fields: string[];
  field_evidence: FieldEvidence[];
  contains_sensitive_data: boolean;
  sensitive_reason: string | null;
  provider: "deterministic";
}

export function deterministicExtract(
  purchaseText: string,
  today: Date = new Date(),
): DeterministicExtractResult {
  const sensitive = detectSensitive(purchaseText);
  const text = stripInjectionAttempts(sensitive.redacted);
  const lower = text.toLowerCase();
  const uncertain: string[] = [];
  const evidence: FieldEvidence[] = [];

  // Retailer
  let retailer: string | null = null;
  if (/\btarget\b/.test(lower) || /target\.com/.test(lower)) {
    retailer = "Target";
    evidence.push({
      field: "retailer",
      confidence: "high",
      evidence: "target mention",
    });
  } else if (
    /\bwalmart\b|\bamazon\b|\bbest\s*buy\b|\bcostco\b|\bwalgreens\b/.test(
      lower,
    )
  ) {
    const m = lower.match(
      /\b(walmart|amazon|best\s*buy|costco|walgreens)\b/,
    );
    retailer = m ? m[1]!.replace(/\s+/g, " ") : "unsupported";
    uncertain.push("retailer");
    evidence.push({
      field: "retailer",
      confidence: "high",
      evidence: "non-target retailer",
    });
  }

  // URL — only if present
  let product_url: string | null = null;
  const urlMatch = text.match(
    /https?:\/\/(?:www\.)?target\.com\/[^\s"'<>]+/i,
  );
  if (urlMatch) {
    product_url = urlMatch[0]!.replace(/[.,;)\]]+$/, "");
    evidence.push({
      field: "product_url",
      confidence: "high",
      evidence: "url in text",
    });
  }

  // Price
  let purchase_price: number | null = null;
  const priceMatch = text.match(
    /\$\s*(\d{1,5}(?:\.\d{1,2})?)|(?:paid|for|cost)\s+\$?\s*(\d{1,5}(?:\.\d{1,2})?)/i,
  );
  if (priceMatch) {
    const raw = priceMatch[1] ?? priceMatch[2];
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) {
      purchase_price = n;
      evidence.push({
        field: "purchase_price",
        confidence: "high",
        evidence: "dollar amount",
      });
    }
  }

  // Currency
  let currency: "USD" | null = null;
  if (/\$|usd\b/i.test(text) && purchase_price != null) {
    currency = "USD";
  }

  // Channel
  let purchase_channel: "target_online" | null = null;
  if (
    retailer === "Target" &&
    (/\bonline\b|\btarget\.com\b|\btarget app\b|\bwebsite\b/.test(lower) ||
      product_url)
  ) {
    purchase_channel = "target_online";
    evidence.push({
      field: "purchase_channel",
      confidence: product_url ? "high" : "medium",
      evidence: "online / app / target.com",
    });
  } else if (retailer === "Target") {
    purchase_channel = "target_online";
    uncertain.push("purchase_channel");
  }

  // Date
  const resolved = resolveRelativeDate(text, today);
  let purchase_date = resolved.date;
  if (resolved.date && resolved.uncertain) {
    uncertain.push("purchase_date");
    evidence.push({
      field: "purchase_date",
      confidence: "uncertain",
      evidence: "relative date",
    });
  } else if (resolved.date) {
    evidence.push({
      field: "purchase_date",
      confidence: "high",
      evidence: "date phrase",
    });
  }

  // Region (2-letter state)
  let region: string | null = null;
  const regionMatch = text.match(
    /\b(?:in|from)\s+([A-Z]{2})\b|\bstate\s*(?:of|:)?\s*([A-Z]{2})\b/,
  );
  if (regionMatch) {
    region = (regionMatch[1] ?? regionMatch[2] ?? null)?.toUpperCase() ?? null;
    if (region) {
      evidence.push({
        field: "region",
        confidence: "medium",
        evidence: "state code",
      });
    }
  }

  // TCIN — only explicit
  let target_item_id: string | null = null;
  const tcin = text.match(/\b(?:tcin|item\s*#?|A-)\s*(\d{5,12})\b/i);
  if (tcin) {
    target_item_id = tcin[1]!;
    evidence.push({
      field: "target_item_id",
      confidence: "high",
      evidence: "tcin/item number",
    });
  } else {
    const fromUrl = product_url?.match(/\/A-(\d{5,12})/i);
    if (fromUrl) {
      target_item_id = fromUrl[1]!;
      evidence.push({
        field: "target_item_id",
        confidence: "medium",
        evidence: "from product url",
      });
      uncertain.push("target_item_id");
    }
  }

  // UPC — only if labeled
  let upc_or_gtin: string | null = null;
  const upc = text.match(/\b(?:upc|gtin)\s*[#:]?\s*(\d{8,14})\b/i);
  if (upc) {
    upc_or_gtin = upc[1]!;
    evidence.push({
      field: "upc_or_gtin",
      confidence: "high",
      evidence: "upc/gtin label",
    });
  }

  // Model — only if labeled (never invent)
  let model_number: string | null = null;
  const model = text.match(/\bmodel\s*(?:number|#)?\s*[:#]?\s*([A-Za-z0-9][A-Za-z0-9._-]{2,})\b/i);
  if (model) {
    model_number = model[1]!;
    evidence.push({
      field: "model_number",
      confidence: "high",
      evidence: "model label",
    });
  }

  // Product description — heuristic phrase after "bought" / "purchased"
  let product_description: string | null = null;
  const bought = text.match(
    /(?:bought|purchased|got)\s+(?:a|an|the)?\s*(.+?)(?:\s+from\s+|\s+at\s+|\s+for\s+\$|\s+yesterday|\s+today|\s+online|$)/i,
  );
  if (bought?.[1]) {
    const desc = bought[1]!.replace(/\s+/g, " ").trim();
    if (desc.length >= 3 && desc.length <= 200) {
      product_description = desc;
      evidence.push({
        field: "product_description",
        confidence: "medium",
        evidence: "description phrase",
      });
      if (desc.length < 8) uncertain.push("product_description");
    }
  }

  const extracted = ExtractedPurchaseSchema.parse({
    retailer,
    product_description,
    product_url,
    purchase_price,
    currency,
    purchase_date,
    purchase_channel,
    region,
    model_number,
    target_item_id,
    upc_or_gtin,
  });

  return {
    extracted,
    uncertain_fields: [...new Set(uncertain)],
    field_evidence: evidence,
    contains_sensitive_data: sensitive.sensitive,
    sensitive_reason: sensitive.reason,
    provider: "deterministic",
  };
}
