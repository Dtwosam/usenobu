import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { SerpApiShoppingClient } from "./client.js";
import { redactJsonValue, assertNoSecretLeak } from "./redact.js";
import type {
  CapabilityFieldReport,
  LiveCapabilityReport,
  SerpApiShoppingResult,
} from "./types.js";

export const DEFAULT_LIVE_AUDIT_QUERY =
  "Apple AirPods Pro 2 USB-C Target";

export const DEFAULT_LIVE_AUDIT_LOCATION = "Austin, Texas, United States";

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

/**
 * Build a field-level capability report from a normalized SerpApi result.
 * Does not invent live proof — reports only what the payload actually contains.
 */
export function buildCapabilityReport(
  result: SerpApiShoppingResult,
  options?: { auditId?: string; redactedFixturePath?: string },
): LiveCapabilityReport {
  const primary = result.target_offers[0] ?? result.offers[0];
  const fields: CapabilityFieldReport[] = [
    field("provider", true, undefined, result.provider),
    field("engine", true, undefined, result.engine),
    field("provider_status", true, undefined, result.provider_status),
    field("observed_at", Boolean(result.observed_at), undefined, result.observed_at),
    field("query", Boolean(result.query.q), undefined, result.query.q),
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
      undefined,
      primary?.title ? truncate(primary.title, 80) : null,
    ),
    field(
      "product_url_or_link",
      Boolean(primary?.link || primary?.product_link),
      "link and/or product_link",
      primary?.link || primary?.product_link || null,
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
      "SerpApi product_id if present — not a Target TCIN guarantee",
      primary?.product_id ?? null,
    ),
    field(
      "immersive_product_page_token",
      Boolean(primary?.immersive_product_page_token),
      undefined,
      primary?.immersive_product_page_token
        ? "[present]"
        : null,
    ),
    field(
      "target_offer_present",
      result.target_offers.length > 0,
      `count=${result.target_offers.length}`,
      result.target_offers.length > 0,
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
    query: result.query.q,
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
  };
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}

/**
 * Run one bounded live Google Shopping query and write redacted proof artifacts.
 */
export async function runBoundedLiveCapabilityAudit(
  client: SerpApiShoppingClient,
  options?: {
    q?: string;
    location?: string;
    outDir?: string;
    apiKeyForRedaction?: string;
  },
): Promise<{ result: SerpApiShoppingResult; report: LiveCapabilityReport }> {
  const q = options?.q ?? DEFAULT_LIVE_AUDIT_QUERY;
  const location = options?.location ?? DEFAULT_LIVE_AUDIT_LOCATION;
  const outDir =
    options?.outDir ??
    path.join(process.cwd(), "docs", "proof", "serpapi");

  const result = await client.searchShopping({
    q,
    gl: "us",
    hl: "en",
    location,
    device: "desktop",
    no_cache: false,
    timeout_ms: 20_000,
  });

  mkdirSync(outDir, { recursive: true });
  const stamp = result.observed_at.replace(/[:.]/g, "-");
  const fixturePath = path.join(
    outDir,
    `live-shopping-redacted-${stamp}.json`,
  );
  const reportPath = path.join(
    outDir,
    `live-capability-report-${stamp}.json`,
  );

  const redactedPayload = redactJsonValue(
    {
      disclaimer:
        "Redacted SerpApi Google Shopping observation. Not an official Target API response. API key removed.",
      live: result.live,
      provider: result.provider,
      engine: result.engine,
      provider_status: result.provider_status,
      query: result.query,
      observed_at: result.observed_at,
      offers: result.offers.map((o) => ({
        title: o.title,
        source_text: o.source_text,
        seller_kind: o.seller_kind,
        is_target_plus: o.is_target_plus,
        extracted_price: o.extracted_price,
        currency: o.currency,
        link: o.link,
        product_link: o.product_link,
        product_id: o.product_id ? "[present]" : null,
        immersive_product_page_token: o.immersive_product_page_token
          ? "[present]"
          : null,
      })),
      target_offers_count: result.target_offers.length,
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
    auditId: `live-${stamp}`,
    redactedFixturePath: path.relative(process.cwd(), fixturePath),
  });
  const reportJson = JSON.stringify(report, null, 2);
  assertNoSecretLeak(reportJson, options?.apiKeyForRedaction);
  writeFileSync(reportPath, `${reportJson}\n`, "utf8");

  // Also write a stable latest pointer for docs (redacted only).
  writeFileSync(
    path.join(outDir, "live-capability-report-latest.json"),
    `${reportJson}\n`,
    "utf8",
  );
  writeFileSync(
    path.join(outDir, "live-shopping-redacted-latest.json"),
    `${fixtureJson}\n`,
    "utf8",
  );

  return { result, report };
}
