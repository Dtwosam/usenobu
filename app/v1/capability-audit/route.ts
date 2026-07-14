/**
 * Temporary release-blocking capability audit endpoint.
 * Uses production SERPAPI_API_KEY at runtime. Returns redacted diagnostics only.
 * Does not change POST /v1/agent or OpenAPI A2MCP contract.
 * Not a consumer product feature.
 */
import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import {
  createSerpApiClientFromEnv,
  isSerpApiConfigured,
} from "@/serpapi/index";
import { toMatchableOffer } from "@/matching/candidates";
import { offerMatchesLockedFingerprint } from "@/matching/confirm";
import {
  extractTcinFromTargetUrl,
  normalizeTargetProductUrl,
} from "@/matching/identity";
import { evaluateProductMatches } from "@/matching/evaluate";
import { buildMonitorShoppingQuery } from "@/web/live-monitor";
import { enrichOffersWithImmersiveTargetLinks } from "@/serpapi/enrich-target-links";
import type { LockedProductFingerprint } from "@/domain/product-fingerprint";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PRODUCTS = [
  {
    id: "conair-gs14",
    title: "Conair ExtremeSteam Handheld Garment Steamer",
    brand: "Conair",
    model: "GS14",
    tcin: "87470797",
    upc: "074108469755",
    url: "https://www.target.com/p/conair-extremesteam-handheld-garment-steamer/-/A-87470797",
  },
  {
    id: "apple-airtag",
    title: "Apple AirTag",
    brand: "Apple",
    model: "AirTag",
    tcin: "54191097",
    upc: "194252096261",
    url: "https://www.target.com/p/apple-airtag/-/A-54191097",
  },
  {
    id: "up-up-acetaminophen",
    title: "up&up Acetaminophen 500mg Caplets 100 Count",
    brand: "up&up",
    model: null as string | null,
    tcin: "14714061",
    upc: null as string | null,
    url: "https://www.target.com/p/acetaminophen-500mg-caplets-100ct-up-up/-/A-14714061",
  },
] as const;

function fingerprintFor(p: (typeof PRODUCTS)[number]): LockedProductFingerprint {
  return {
    fingerprint_id: `fp_audit_${p.id}`,
    target_product_url: p.url,
    target_item_id: p.tcin,
    model_number: p.model || undefined,
    upc_or_gtin: p.upc || undefined,
    product_title: p.title,
    brand: p.brand,
    seller_kind: "target",
    is_target_plus: false,
    confirmed_at: new Date().toISOString(),
    confirmed_by_user: true,
  };
}

function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function redactUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return url.replace(/api_key=[^&]+/gi, "api_key=REDACTED").slice(0, 160);
}

function classifyRejection(
  fp: LockedProductFingerprint,
  offer: ReturnType<typeof toMatchableOffer>,
) {
  const causes: string[] = [];
  if (offer.is_target_plus) causes.push("seller_target_plus");
  if (offer.seller_kind !== "target") causes.push("seller_not_recognized_as_target");

  const offerUrl =
    normalizeTargetProductUrl(offer.merchant_link) ||
    normalizeTargetProductUrl(offer.link) ||
    normalizeTargetProductUrl(offer.product_link);
  const fpUrl = normalizeTargetProductUrl(fp.target_product_url);
  if (!offerUrl) {
    if (offer.link && /google\.|gstatic|serpapi/i.test(offer.link)) {
      causes.push("no_direct_target_url_google_only_link");
    } else if (offer.product_link) {
      causes.push("no_direct_target_url_product_link_only");
    } else {
      causes.push("no_direct_target_url");
    }
  } else if (fpUrl && offerUrl !== fpUrl) {
    causes.push("target_url_path_differs_from_fingerprint");
  }

  const offerTcin =
    offer.target_item_id ||
    extractTcinFromTargetUrl(offer.merchant_link) ||
    extractTcinFromTargetUrl(offer.link) ||
    extractTcinFromTargetUrl(offer.product_link);
  if (!offerTcin) causes.push("tcin_missing_on_offer");
  else if (fp.target_item_id && offerTcin !== fp.target_item_id) {
    causes.push("explicit_tcin_conflict");
  }

  if (!offer.model_number) causes.push("model_missing_on_offer_structured");
  if (!offer.upc_or_gtin) causes.push("upc_missing_on_offer_structured");
  if (offer.observed_price == null || !(offer.observed_price > 0)) {
    causes.push("price_malformed_or_missing");
  }

  const mon = offerMatchesLockedFingerprint(fp, offer);
  return {
    monitor_match: mon.match,
    monitor_reasons: mon.reasons,
    diagnostic_causes: causes,
  };
}

/**
 * GET /v1/capability-audit
 * Bounded live SerpApi audit (max 3 products / 3 searches).
 */
export async function GET() {
  const at = new Date().toISOString();
  if (!isSerpApiConfigured()) {
    return NextResponse.json(
      {
        at,
        gate3_verdict: "PROVIDER_CONFIGURATION_BLOCKED",
        blocker: "SERPAPI_API_KEY not available to runtime",
        key_configured: false,
        products: [],
        searches_consumed: 0,
        accepted: [],
      },
      { status: 503 },
    );
  }

  const client = createSerpApiClientFromEnv();
  if (!client) {
    return NextResponse.json(
      {
        at,
        gate3_verdict: "PROVIDER_CONFIGURATION_BLOCKED",
        blocker: "Client factory returned null",
        key_configured: true,
        products: [],
        searches_consumed: 0,
        accepted: [],
      },
      { status: 503 },
    );
  }

  const out: {
    at: string;
    audit: string;
    key_configured: boolean;
    products: unknown[];
    searches_consumed: number;
    accepted: unknown[];
    gate3_verdict: string | null;
    rejection_histogram?: Record<string, number>;
  } = {
    at,
    audit: "live-target-price-capability-runtime",
    key_configured: true,
    products: [],
    searches_consumed: 0,
    accepted: [],
    gate3_verdict: null,
  };

  for (const p of PRODUCTS) {
    if (client.getUsageCount() >= 3) break;
    const fp = fingerprintFor(p);
    const q = buildMonitorShoppingQuery(fp);
    const a2mcpQuery = [p.model, p.tcin, p.upc, "Target"]
      .filter(Boolean)
      .join(" ");

    let result;
    try {
      result = await client.searchShopping({
        q,
        gl: "us",
        hl: "en",
        location: "Austin, Texas, United States",
        device: "desktop",
        timeout_ms: 25_000,
      });
    } catch (e) {
      out.products.push({
        product_id: p.id,
        query: q,
        provider_status: "PROVIDER_ERROR",
        error: String((e as Error)?.message || e).slice(0, 120),
      });
      continue;
    }

    let offers = (result.offers || []).map((o) => toMatchableOffer(o));
    let immersive_meta: Record<string, unknown> = { immersive_searches: 0 };
    const preMatch = offers.some(
      (o) => offerMatchesLockedFingerprint(fp, o).match,
    );
    if (!preMatch) {
      try {
        const enriched = await enrichOffersWithImmersiveTargetLinks({
          client,
          offers,
          reference_title: p.title,
          expected_tcin: p.tcin,
          max_immersive_searches: 1,
        });
        offers = enriched.offers;
        immersive_meta = {
          immersive_searches: enriched.immersive_searches,
          enriched_count: enriched.enriched_count,
          selected_title: enriched.selected_title ?? null,
          target_link: enriched.target_link
            ? String(enriched.target_link).slice(0, 120)
            : null,
          target_tcin: enriched.target_tcin ?? null,
        };
      } catch (e) {
        immersive_meta = {
          immersive_searches: 0,
          error: String((e as Error)?.message || e).slice(0, 120),
        };
      }
    }
    out.searches_consumed = client.getUsageCount();
    const targetOffers = offers.filter(
      (o) => o.seller_kind === "target" && !o.is_target_plus,
    );

    const enroll = evaluateProductMatches(
      {
        target_product_url: p.url,
        target_item_id: p.tcin,
        model_number: p.model || undefined,
        upc_or_gtin: p.upc || undefined,
        product_title: p.title,
      },
      offers,
    );

    const candidates = offers.slice(0, 15).map((o, i) => {
      const evalR = classifyRejection(fp, o);
      return {
        index: i,
        title: (o.title || "").slice(0, 100),
        source: o.seller_text,
        seller_kind: o.seller_kind,
        is_target_plus: o.is_target_plus,
        price: o.observed_price ?? null,
        merchant_link: redactUrl(o.merchant_link),
        link_host: hostOf(o.link) || hostOf(o.merchant_link),
        product_link_host: hostOf(o.product_link),
        product_link_present: Boolean(o.product_link),
        google_product_id_prefix: o.serpapi_product_id
          ? String(o.serpapi_product_id).slice(0, 12)
          : null,
        tcin_extracted:
          o.target_item_id ||
          extractTcinFromTargetUrl(o.merchant_link) ||
          extractTcinFromTargetUrl(o.link) ||
          null,
        model_structured: o.model_number ?? null,
        upc_structured: o.upc_or_gtin ?? null,
        tcin_matches_expected:
          (o.target_item_id ||
            extractTcinFromTargetUrl(o.merchant_link) ||
            extractTcinFromTargetUrl(o.link)) === p.tcin,
        ...evalR,
      };
    });

    const accepted = candidates.filter((c) => c.monitor_match);
    const row = {
      product_id: p.id,
      title: p.title,
      tcin: p.tcin,
      query_monitor: q,
      query_a2mcp_style: a2mcpQuery,
      provider_status: result.provider_status,
      result_count: offers.length,
      target_source_count: targetOffers.length,
      target_shoprs_tokens: result.target_shoprs_tokens?.length ?? 0,
      immersive: immersive_meta,
      enrollment_decision: enroll.decision,
      enrollment_reasons: enroll.reasons,
      enrollment_exact_tcin: enroll.exact_candidate?.matched_tcin ?? null,
      enrollment_exact_price:
        enroll.exact_candidate?.offer.observed_price ?? null,
      candidates,
      accepted_count: accepted.length,
      payload_fingerprint: createHash("sha256")
        .update(
          JSON.stringify({
            q,
            n: offers.length,
            status: result.provider_status,
          }),
        )
        .digest("hex")
        .slice(0, 16),
    };
    out.products.push(row);
    if (accepted.length) {
      out.accepted.push({
        product_id: p.id,
        path: accepted[0]!.monitor_reasons,
        price: accepted[0]!.price,
        title: accepted[0]!.title,
        source: accepted[0]!.source,
      });
    }
  }

  if (out.accepted.length > 0) {
    out.gate3_verdict = "SERPAPI_TARGET_PRICE_CAPABILITY_PROVEN";
  } else {
    const causeCounts: Record<string, number> = {};
    for (const p of out.products as Array<{
      candidates?: Array<{
        seller_kind?: string;
        diagnostic_causes?: string[];
        monitor_reasons?: string[];
      }>;
      target_source_count?: number;
    }>) {
      for (const c of p.candidates || []) {
        if (c.seller_kind !== "target") continue;
        for (const d of c.diagnostic_causes || []) {
          causeCounts[d] = (causeCounts[d] || 0) + 1;
        }
        for (const r of c.monitor_reasons || []) {
          causeCounts[`match:${r}`] = (causeCounts[`match:${r}`] || 0) + 1;
        }
      }
    }
    out.rejection_histogram = causeCounts;
    const noTarget = (out.products as Array<{ target_source_count?: number }>).every(
      (p) => (p.target_source_count ?? 0) === 0,
    );
    if (noTarget) {
      out.gate3_verdict = "SERPAPI_TARGET_COVERAGE_INSUFFICIENT";
    } else if (causeCounts["no_direct_target_url_google_only_link"]) {
      out.gate3_verdict = "SERPAPI_NORMALIZATION_REPAIR_REQUIRED";
    } else {
      out.gate3_verdict = "SERPAPI_MATCH_CONTRACT_INCOMPATIBLE";
    }
  }

  return NextResponse.json(out, {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
      "X-Nobu-Audit": "capability-only",
    },
  });
}
