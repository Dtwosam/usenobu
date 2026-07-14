/**
 * Live Target price capability audit — bounded SerpApi searches.
 * Requires SERPAPI_API_KEY in environment. Never prints the key.
 * Usage: node --import tsx docs/proof/live-target-price-capability/run-capability-audit.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

// Load .env.audit / .env.local if present (before client import)
for (const f of [".env.audit", ".env.local", ".env"]) {
  const p = path.resolve(f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (v && !process.env[k]) process.env[k] = v;
  }
}

const { createSerpApiClientFromEnv } = await import(
  "../../../src/serpapi/client.ts"
);
const { toMatchableOffer } = await import(
  "../../../src/matching/candidates.ts"
);
const { offerMatchesLockedFingerprint } = await import(
  "../../../src/matching/confirm.ts"
);
const { extractTcinFromTargetUrl, normalizeTargetProductUrl } = await import(
  "../../../src/matching/identity.ts"
);
const { buildMonitorShoppingQuery } = await import(
  "../../../src/web/live-monitor.ts"
);

const proofDir = path.resolve("docs/proof/live-target-price-capability");
fs.mkdirSync(proofDir, { recursive: true });

/** Public Target products for audit (identifiers are public catalog data). */
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
    id: "dyson-v8",
    title: "Dyson V8 Origin Cordless Stick Vacuum",
    brand: "Dyson",
    model: "V8 Origin",
    tcin: "85269288",
    upc: "885609027470",
    url: "https://www.target.com/p/dyson-v8-origin-cordless-stick-vacuum/-/A-85269288",
  },
  {
    id: "up-up-acetaminophen",
    title: "up&up Acetaminophen 500mg Caplets 100 Count",
    brand: "up&up",
    model: null,
    tcin: "14714061",
    upc: null,
    url: "https://www.target.com/p/acetaminophen-500mg-caplets-100ct-up-up/-/A-14714061",
  },
  {
    id: "good-gather-pita",
    title: "Good & Gather Sea Salt Pita Chips 9oz",
    brand: "Good & Gather",
    model: null,
    tcin: "54556324",
    upc: null,
    url: "https://www.target.com/p/sea-salt-pita-chips-9oz-good-gather/-/A-54556324",
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
];

function fingerprintFor(p) {
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

function queryFor(p) {
  return buildMonitorShoppingQuery(fingerprintFor(p));
}

/** Detailed rejection classification (not collapsed). */
function classifyRejection(fp, offer) {
  const causes = [];
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

  const match = offerMatchesLockedFingerprint(fp, offer);
  return {
    match: match.match,
    match_reasons: match.reasons,
    diagnostic_causes: causes,
  };
}

const client = createSerpApiClientFromEnv();
const out = {
  at: new Date().toISOString(),
  audit: "live-target-price-capability",
  key_configured: Boolean(process.env.SERPAPI_API_KEY?.trim()),
  products: [],
  searches_consumed: 0,
  accepted: [],
  gate3_verdict: null,
};

if (!client) {
  out.gate3_verdict = "PROVIDER_CONFIGURATION_BLOCKED";
  out.blocker =
    "SERPAPI_API_KEY not available in audit environment (empty or unset). Production health may still report configured if secrets are injected only at runtime without pullable values.";
  fs.writeFileSync(
    path.join(proofDir, "capability-audit.json"),
    JSON.stringify(out, null, 2),
  );
  console.log(JSON.stringify(out, null, 2));
  process.exit(2);
}

const MAX = 5;
for (const p of PRODUCTS) {
  if (client.getUsageCount() >= MAX) break;
  const fp = fingerprintFor(p);
  const q = queryFor(p);
  const result = await client.searchShopping({
    q,
    gl: "us",
    hl: "en",
    location: "Austin, Texas, United States",
    device: "desktop",
    timeout_ms: 25_000,
  });
  out.searches_consumed = client.getUsageCount();

  const offers = (result.offers || []).map((o) => toMatchableOffer(o));
  const targetOffers = offers.filter(
    (o) => o.seller_kind === "target" && !o.is_target_plus,
  );

  const candidates = offers.slice(0, 12).map((o, i) => {
    const evalR = classifyRejection(fp, o);
    return {
      index: i,
      title: (o.title || "").slice(0, 100),
      source: o.seller_text,
      seller_kind: o.seller_kind,
      is_target_plus: o.is_target_plus,
      price: o.observed_price ?? null,
      merchant_link: o.merchant_link
        ? o.merchant_link.replace(/api_key=[^&]+/gi, "api_key=REDACTED").slice(0, 120)
        : null,
      link_host: (() => {
        try {
          return new URL(o.link || o.merchant_link || "http://x").hostname;
        } catch {
          return null;
        }
      })(),
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

  const accepted = candidates.filter((c) => c.match);
  const row = {
    product_id: p.id,
    title: p.title,
    tcin: p.tcin,
    query: q,
    provider_status: result.provider_status,
    result_count: offers.length,
    target_source_count: targetOffers.length,
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
      path: accepted[0].match_reasons,
      price: accepted[0].price,
      title: accepted[0].title,
    });
  }

  console.log(
    JSON.stringify({
      product: p.id,
      q,
      status: result.provider_status,
      results: offers.length,
      target: targetOffers.length,
      accepted: accepted.length,
      top_rejection: candidates[0]?.diagnostic_causes?.slice(0, 4),
    }),
  );
}

if (out.accepted.length > 0) {
  out.gate3_verdict = "SERPAPI_TARGET_PRICE_CAPABILITY_PROVEN";
} else {
  // Analyze dominant rejection patterns
  const causeCounts = {};
  for (const p of out.products) {
    for (const c of p.candidates) {
      if (c.seller_kind !== "target") continue;
      for (const d of c.diagnostic_causes || []) {
        causeCounts[d] = (causeCounts[d] || 0) + 1;
      }
      for (const r of c.match_reasons || []) {
        causeCounts[`match:${r}`] = (causeCounts[`match:${r}`] || 0) + 1;
      }
    }
  }
  out.rejection_histogram = causeCounts;
  const noTarget = out.products.every((p) => p.target_source_count === 0);
  const allGoogleOnly = Object.keys(causeCounts).some((k) =>
    k.includes("no_direct_target_url"),
  );
  if (noTarget) {
    out.gate3_verdict = "SERPAPI_TARGET_COVERAGE_INSUFFICIENT";
  } else if (allGoogleOnly || causeCounts["no_direct_target_url_google_only_link"]) {
    out.gate3_verdict = "SERPAPI_NORMALIZATION_REPAIR_REQUIRED";
  } else {
    out.gate3_verdict = "SERPAPI_MATCH_CONTRACT_INCOMPATIBLE";
  }
}

fs.writeFileSync(
  path.join(proofDir, "capability-audit.json"),
  JSON.stringify(out, null, 2),
);
console.log(JSON.stringify({ verdict: out.gate3_verdict, searches: out.searches_consumed, accepted: out.accepted }, null, 2));
process.exit(out.accepted.length > 0 ? 0 : 1);
