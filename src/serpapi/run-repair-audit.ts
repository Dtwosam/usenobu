/**
 * Lane 3 repair: bounded live capability audit (max 4 new SerpApi searches).
 *
 * Strategy:
 * 1) Exact model/title product queries (not broad "… Target" title-only)
 * 2) Capture filters/shoprs; if a Target store filter token appears, test it
 * 3) Stop early when Lane 3 pass criteria are met
 *
 * Usage: npx tsx src/serpapi/run-repair-audit.ts
 * Requires SERPAPI_API_KEY. Never prints the key.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import {
  createSerpApiClientFromEnv,
  meetsLane3LivePassCriteria,
  REPAIR_AUDIT_PRODUCTS,
  writeRedactedProof,
  type SerpApiShoppingResult,
} from "./index.js";

const MAX_SEARCHES = 4;
const LOCATION = "Austin, Texas, United States";

interface QueryAttempt {
  label: string;
  q?: string;
  shoprs?: string;
  result: SerpApiShoppingResult;
  pass: boolean;
  reasons: string[];
}

async function main(): Promise<void> {
  const client = createSerpApiClientFromEnv();
  if (!client) {
    console.error(
      "NOBU_LANE_3_BLOCKED: SERPAPI_API_KEY is not set. Cannot run live repair audit.",
    );
    process.exitCode = 2;
    return;
  }

  const apiKey = process.env.SERPAPI_API_KEY;
  const attempts: QueryAttempt[] = [];
  let targetShoprs: string | undefined;
  let passing: QueryAttempt | undefined;

  const products = REPAIR_AUDIT_PRODUCTS.slice(0, 3);

  for (const product of products) {
    if (client.getUsageCount() >= MAX_SEARCHES) break;

    const result = await client.searchShopping({
      q: product.exact_query,
      gl: "us",
      hl: "en",
      location: LOCATION,
      device: "desktop",
      no_cache: false,
      timeout_ms: 25_000,
    });

    writeRedactedProof(result, {
      apiKeyForRedaction: apiKey,
      prefix: `repair-${product.id}`,
    });

    if (!targetShoprs && result.target_shoprs_tokens[0]) {
      targetShoprs = result.target_shoprs_tokens[0];
    }
    // Also harvest any filter option that mentions Target with shoprs
    if (!targetShoprs) {
      for (const g of result.filters) {
        for (const o of g.options) {
          if (o.is_target_store_filter && o.shoprs) {
            targetShoprs = o.shoprs;
            break;
          }
        }
        if (targetShoprs) break;
      }
    }

    const verdict = meetsLane3LivePassCriteria(result);
    const attempt: QueryAttempt = {
      label: product.exact_query,
      q: product.exact_query,
      result,
      pass: verdict.pass,
      reasons: verdict.reasons,
    };
    attempts.push(attempt);

    console.log(
      JSON.stringify({
        search: client.getUsageCount(),
        label: product.id,
        q: product.exact_query,
        provider_status: result.provider_status,
        offers: result.offers.length,
        target_offers: result.target_offers.length,
        target_shoprs_found: result.target_shoprs_tokens.length > 0,
        merchant_links: result.offers.filter((o) => o.merchant_link).length,
        pass: verdict.pass,
        reasons: verdict.reasons,
      }),
    );

    if (verdict.pass) {
      passing = attempt;
      break;
    }
  }

  // Use remaining budget for shoprs Target filter test if discovered
  if (
    !passing &&
    targetShoprs &&
    client.getUsageCount() < MAX_SEARCHES
  ) {
    const q = products[0]?.exact_query ?? "Apple AirPods Pro MTJV3AM/A";
    const result = await client.searchShopping({
      q,
      shoprs: targetShoprs,
      gl: "us",
      hl: "en",
      location: LOCATION,
      device: "desktop",
      timeout_ms: 25_000,
    });
    writeRedactedProof(result, {
      apiKeyForRedaction: apiKey,
      prefix: "repair-shoprs-target",
    });
    const verdict = meetsLane3LivePassCriteria(result);
    const attempt: QueryAttempt = {
      label: `${q} + shoprs(Target)`,
      q,
      shoprs: "[present]",
      result,
      pass: verdict.pass,
      reasons: verdict.reasons,
    };
    attempts.push(attempt);
    console.log(
      JSON.stringify({
        search: client.getUsageCount(),
        label: "shoprs-target",
        q,
        shoprs: true,
        provider_status: result.provider_status,
        offers: result.offers.length,
        target_offers: result.target_offers.length,
        pass: verdict.pass,
        reasons: verdict.reasons,
      }),
    );
    if (verdict.pass) passing = attempt;
  }

  // If still failing and budget remains, one broader exact model-only query
  if (!passing && client.getUsageCount() < MAX_SEARCHES) {
    const q = "MTJV3AM/A";
    const result = await client.searchShopping({
      q,
      gl: "us",
      hl: "en",
      location: LOCATION,
      device: "desktop",
      timeout_ms: 25_000,
    });
    writeRedactedProof(result, {
      apiKeyForRedaction: apiKey,
      prefix: "repair-model-only",
    });
    const verdict = meetsLane3LivePassCriteria(result);
    attempts.push({
      label: q,
      q,
      result,
      pass: verdict.pass,
      reasons: verdict.reasons,
    });
    console.log(
      JSON.stringify({
        search: client.getUsageCount(),
        label: "model-only",
        q,
        provider_status: result.provider_status,
        offers: result.offers.length,
        target_offers: result.target_offers.length,
        pass: verdict.pass,
        reasons: verdict.reasons,
      }),
    );
    if (verdict.pass) {
      passing = attempts[attempts.length - 1];
    }
  }

  const summary = {
    verdict: passing ? "NOBU_LANE_3_PASS" : "NOBU_LANE_3_BLOCKED",
    searches_consumed: client.getUsageCount(),
    max_searches: MAX_SEARCHES,
    target_shoprs_discovered: Boolean(targetShoprs),
    queries: attempts.map((a) => ({
      label: a.label,
      provider_status: a.result.provider_status,
      offers: a.result.offers.length,
      target_offers: a.result.target_offers.length,
      merchant_links: a.result.offers.filter((o) => o.merchant_link).length,
      utf8_ok_titles: a.result.offers.filter((o) => o.title_utf8_ok).length,
      pass: a.pass,
      reasons: a.reasons,
    })),
    passing_query: passing?.label ?? null,
    usage: client.getUsageEntries().map((e) => ({
      query: e.query,
      live: e.live,
      http_status: e.http_status,
      provider_status: e.provider_status,
      shoprs_used: e.shoprs_used ?? false,
    })),
    disclaimer:
      "SerpApi third-party observation only. Not an official Target API. No matching engine run.",
  };

  const outDir = path.join(process.cwd(), "docs", "proof", "serpapi");
  mkdirSync(outDir, { recursive: true });
  const summaryPath = path.join(outDir, "repair-audit-summary.json");
  writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(summary, null, 2));

  process.exitCode = passing ? 0 : 3;
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`Repair audit failed: ${msg}`);
  process.exitCode = 1;
});
