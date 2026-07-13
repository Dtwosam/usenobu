import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { SerpApiShoppingClient } from "./client.js";
import { redactJsonValue, assertNoSecretLeak } from "./redact.js";
import type {
  CapabilityFieldReport,
  LiveCapabilityReport,
  SerpApiShoppingResult,
} from "./types.js";

export const DEFAULT_LIVE_AUDIT_LOCATION = "Austin, Texas, United States";

/**
 * Exact-identity Target.com products for bounded live audit (Lane 3 repair).
 * Identifiers are public product labels — not invented live offers.
 */
export const REPAIR_AUDIT_PRODUCTS = [
  {
    id: "airpods-pro-2-usbc",
    title: "Apple AirPods Pro 2nd Generation with MagSafe Case USB-C",
    model: "MTJV3AM/A",
    exact_query: "Apple AirPods Pro MTJV3AM/A",
  },
  {
    id: "up-and-up-acetaminophen",
    title: "up&up Acetaminophen 500mg Tablets",
    // Public Target house brand product; count may vary
    model: "up&up acetaminophen 500 mg",
    exact_query: "up&up acetaminophen 500 mg 100 tablets",
  },
  {
    id: "good-and-gather-pita",
    title: "Good & Gather Sea Salt Pita Chips",
    model: "Good & Gather Sea Salt Pita Chips",
    exact_query: "Good & Gather Sea Salt Pita Chips 9 oz",
  },
] as const;

function field(
  name: string,
  available: boolean,
  notes?: string,
  sample?: string | number | boolean | null,
): CapabilityFieldReport {
  return {
    field: name,
    available,
    notes,
    sample_redacted: sample === undefined ? undefined : sample,
  };
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}

/**
 * Build a field-level capability report from a normalized SerpApi result.
 * Does not invent live proof — reports only what the payload actually contains.
 */
export function buildCapabilityReport(
  result: SerpApiShoppingResult,
  options?: { auditId?: string; redactedFixturePath?: string },
): LiveCapabilityReport {
  const primary = result.target_offers[0] ?? result.offers[0];
  const merchantLinkAvailable = Boolean(
    result.target_offers.some((o) => o.merchant_link) ||
      result.offers.some((o) => o.merchant_link),
  );

  const fields: CapabilityFieldReport[] = [
    field("provider", true, undefined, result.provider),
    field("engine", true, undefined, result.engine),
    field("provider_status", true, undefined, result.provider_status),
    field("observed_at", Boolean(result.observed_at), undefined, result.observed_at),
    field("query", Boolean(result.query.q), undefined, result.query.q),
    field("shoprs", Boolean(result.query.shoprs), undefined, result.query.shoprs ? "[present]" : null),
    field("gl", Boolean(result.query.gl), undefined, result.query.gl),
    field("hl", Boolean(result.query.hl), undefined, result.query.hl),
    field("location", Boolean(result.query.location), undefined, result.query.location),
    field(
      "seller_source_text",
      Boolean(primary?.source_text),
      primary ? undefined : "no offer rows",
      primary?.source_text ?? null,
    ),
    field(
      "seller_kind",
      primary?.seller_kind !== undefined,
      undefined,
      primary?.seller_kind ?? null,
    ),
    field(
      "is_target_plus",
      primary !== undefined,
      undefined,
      primary?.is_target_plus ?? null,
    ),
    field(
      "product_title",
      Boolean(primary?.title),
      primary?.title_utf8_ok === false ? "title failed UTF-8 well-formed check" : undefined,
      primary?.title ? truncate(primary.title, 80) : null,
    ),
    field(
      "title_utf8_ok",
      primary?.title_utf8_ok === true,
      undefined,
      primary?.title_utf8_ok ?? null,
    ),
    field(
      "merchant_direct_link",
      Boolean(primary?.merchant_link),
      "non-Google merchant URL when returned",
      primary?.merchant_link ?? null,
    ),
    field(
      "google_product_link",
      Boolean(primary?.product_link),
      "Google Shopping product page — not Target.com",
      primary?.product_link ? "[google product link present]" : null,
    ),
    field(
      "extracted_price",
      primary?.extracted_price !== undefined,
      undefined,
      primary?.extracted_price ?? null,
    ),
    field(
      "currency",
      primary?.currency !== undefined,
      "assumed USD when price parsed",
      primary?.currency ?? null,
    ),
    field(
      "product_id",
      Boolean(primary?.product_id),
      "SerpApi/Google product_id if present — not a Target TCIN guarantee",
      primary?.product_id ?? null,
    ),
    field(
      "immersive_product_page_token",
      Boolean(primary?.immersive_product_page_token),
      undefined,
      primary?.immersive_product_page_token ? "[present]" : null,
    ),
    field(
      "target_offer_present",
      result.target_offers.length > 0,
      `count=${result.target_offers.length}`,
      result.target_offers.length > 0,
    ),
    field(
      "target_shoprs_filter",
      result.target_shoprs_tokens.length > 0,
      `tokens=${result.target_shoprs_tokens.length}`,
      result.target_shoprs_tokens.length > 0 ? "[present]" : null,
    ),
    field(
      "raw_result_hash",
      Boolean(result.raw_result_hash),
      undefined,
      result.raw_result_hash,
    ),
    field(
      "search_metadata.id",
      Boolean(result.search_metadata?.id),
      undefined,
      result.search_metadata?.id ?? null,
    ),
  ];

  const missing_fields = fields.filter((f) => !f.available).map((f) => f.field);
  const notes: string[] = [
    "SerpApi is a third-party search observation source, not an official Target API.",
    "This audit does not perform product matching or eligibility decisions (Lane 4+).",
    `provider_status=${result.provider_status}`,
    `total_offers=${result.offers.length}; target_offers=${result.target_offers.length}`,
    `target_shoprs_tokens=${result.target_shoprs_tokens.length}`,
    `merchant_link_available=${merchantLinkAvailable}`,
  ];
  if (result.error_message) {
    notes.push(`error=${result.error_message}`);
  }
  if (!result.live) {
    notes.push("Result is fixture/offline — not live proof.");
  }

  return {
    audit_id: options?.auditId ?? `audit-${result.observed_at}`,
    audited_at: result.observed_at,
    live: result.live,
    provider: "SerpApi",
    engine: "google_shopping",
    query: result.query.q || (result.query.shoprs ? "[shoprs-only]" : ""),
    location: result.query.location,
    provider_status: result.provider_status,
    searches_consumed: result.searches_recorded,
    target_offer_count: result.target_offers.length,
    total_offer_count: result.offers.length,
    fields,
    missing_fields,
    notes,
    redacted_fixture_path: options?.redactedFixturePath,
    disclaimer:
      "Third-party observed shopping data only. Target verifies price and makes the final adjustment decision. No refund guarantee.",
    target_shoprs_found: result.target_shoprs_tokens.length > 0,
    merchant_link_available: merchantLinkAvailable,
  };
}

export function writeRedactedProof(
  result: SerpApiShoppingResult,
  options?: {
    outDir?: string;
    apiKeyForRedaction?: string;
    prefix?: string;
  },
): { fixturePath: string; reportPath: string; report: LiveCapabilityReport } {
  const outDir =
    options?.outDir ?? path.join(process.cwd(), "docs", "proof", "serpapi");
  mkdirSync(outDir, { recursive: true });
  const stamp = result.observed_at.replace(/[:.]/g, "-");
  const prefix = options?.prefix ?? "live";
  const fixturePath = path.join(outDir, `${prefix}-shopping-redacted-${stamp}.json`);
  const reportPath = path.join(outDir, `${prefix}-capability-report-${stamp}.json`);

  const redactedPayload = redactJsonValue(
    {
      disclaimer:
        "Redacted SerpApi Google Shopping observation. Not an official Target API response. API key removed.",
      live: result.live,
      provider: result.provider,
      engine: result.engine,
      provider_status: result.provider_status,
      query: {
        ...result.query,
        shoprs: result.query.shoprs ? "[REDACTED_SHOPRS]" : undefined,
      },
      observed_at: result.observed_at,
      offers: result.offers.map((o) => ({
        title: o.title,
        title_utf8_ok: o.title_utf8_ok,
        source_text: o.source_text,
        seller_kind: o.seller_kind,
        is_target_plus: o.is_target_plus,
        extracted_price: o.extracted_price,
        currency: o.currency,
        merchant_link: o.merchant_link ?? null,
        product_link: o.product_link ? "[google product link]" : null,
        link_is_google_only: Boolean(
          o.product_link && !o.merchant_link,
        ),
        product_id: o.product_id ? "[present]" : null,
        immersive_product_page_token: o.immersive_product_page_token
          ? "[present]"
          : null,
      })),
      target_offers_count: result.target_offers.length,
      target_offers: result.target_offers.map((o) => ({
        title: o.title,
        title_utf8_ok: o.title_utf8_ok,
        source_text: o.source_text,
        extracted_price: o.extracted_price,
        merchant_link: o.merchant_link ?? null,
        product_id: o.product_id ? "[present]" : null,
      })),
      filters_summary: result.filters.map((g) => ({
        type: g.type ?? null,
        options: g.options.map((o) => ({
          text: o.text,
          is_target_store_filter: o.is_target_store_filter,
          shoprs: o.shoprs ? "[present]" : null,
        })),
      })),
      target_shoprs_tokens_present: result.target_shoprs_tokens.length,
      search_metadata: result.search_metadata
        ? {
            id: result.search_metadata.id,
            status: result.search_metadata.status,
            total_time_taken: result.search_metadata.total_time_taken,
          }
        : null,
      raw_result_hash: result.raw_result_hash,
      searches_recorded: result.searches_recorded,
      error_message: result.error_message ?? null,
    },
    options?.apiKeyForRedaction,
  );

  const fixtureJson = JSON.stringify(redactedPayload, null, 2);
  assertNoSecretLeak(fixtureJson, options?.apiKeyForRedaction);
  writeFileSync(fixturePath, `${fixtureJson}\n`, "utf8");

  const report = buildCapabilityReport(result, {
    auditId: `${prefix}-${stamp}`,
    redactedFixturePath: path.relative(process.cwd(), fixturePath),
  });
  const reportJson = JSON.stringify(report, null, 2);
  assertNoSecretLeak(reportJson, options?.apiKeyForRedaction);
  writeFileSync(reportPath, `${reportJson}\n`, "utf8");
  writeFileSync(
    path.join(outDir, `${prefix}-capability-report-latest.json`),
    `${reportJson}\n`,
    "utf8",
  );
  writeFileSync(
    path.join(outDir, `${prefix}-shopping-redacted-latest.json`),
    `${fixtureJson}\n`,
    "utf8",
  );

  return { fixturePath, reportPath, report };
}

/**
 * Run one bounded live Google Shopping query and write redacted proof artifacts.
 */
export async function runBoundedLiveCapabilityAudit(
  client: SerpApiShoppingClient,
  options?: {
    q?: string;
    shoprs?: string;
    location?: string;
    outDir?: string;
    apiKeyForRedaction?: string;
    prefix?: string;
  },
): Promise<{ result: SerpApiShoppingResult; report: LiveCapabilityReport }> {
  const q = options?.q;
  const location = options?.location ?? DEFAULT_LIVE_AUDIT_LOCATION;

  const result = await client.searchShopping({
    q,
    shoprs: options?.shoprs,
    gl: "us",
    hl: "en",
    location,
    device: "desktop",
    no_cache: false,
    timeout_ms: 25_000,
  });

  const { report } = writeRedactedProof(result, {
    outDir: options?.outDir,
    apiKeyForRedaction: options?.apiKeyForRedaction,
    prefix: options?.prefix ?? "live",
  });

  return { result, report };
}

/**
 * Pass criteria for Lane 3: at least one Target-sold offer with usable price
 * and enough identity evidence for later fail-closed matching (title + price +
 * seller Target; product_id and/or merchant_link preferred).
 */
export function meetsLane3LivePassCriteria(result: SerpApiShoppingResult): {
  pass: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];
  const t = result.target_offers[0];
  if (!t) {
    return { pass: false, reasons: ["no_target_sold_offer"] };
  }
  if (t.extracted_price === undefined || !(t.extracted_price > 0)) {
    reasons.push("missing_usable_price");
  }
  if (!t.title || !t.title_utf8_ok) {
    reasons.push("missing_or_bad_title");
  }
  if (t.seller_kind !== "target" || t.is_target_plus) {
    reasons.push("seller_not_target");
  }
  const hasIdentity =
    Boolean(t.product_id) ||
    Boolean(t.merchant_link) ||
    Boolean(t.product_link && t.title);
  if (!hasIdentity) {
    reasons.push("insufficient_identity_evidence");
  }
  if (reasons.length === 0) {
    reasons.push("target_offer_with_price_and_identity");
  }
  return { pass: reasons[0] === "target_offer_with_price_and_identity", reasons };
}
