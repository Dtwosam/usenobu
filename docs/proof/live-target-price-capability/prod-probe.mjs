/**
 * Bounded production A2MCP probes for capability audit (no SerpApi key required locally).
 * Does not print secrets. Max 5 products.
 */
import fs from "node:fs";
import path from "node:path";

const base = process.env.NOBU_BASE || "https://usenobu.vercel.app";
const proofDir = path.resolve("docs/proof/live-target-price-capability");
fs.mkdirSync(proofDir, { recursive: true });

/** Strict A2mcpRequestSchema fields only (no product_title/brand). */
const PRODUCTS = [
  {
    id: "conair-gs14",
    model_number: "GS14",
    target_item_id: "87470797",
    upc_or_gtin: "074108469755",
    target_product_url:
      "https://www.target.com/p/conair-extremesteam-handheld-garment-steamer/-/A-87470797",
    purchase_price: 39.99,
  },
  {
    id: "dyson-v8",
    model_number: "V8 Origin",
    target_item_id: "85269288",
    upc_or_gtin: "885609027470",
    target_product_url:
      "https://www.target.com/p/dyson-v8-origin-cordless-stick-vacuum/-/A-85269288",
    purchase_price: 399.99,
  },
  {
    id: "up-up-acetaminophen",
    target_item_id: "14714061",
    target_product_url:
      "https://www.target.com/p/acetaminophen-500mg-caplets-100ct-up-up/-/A-14714061",
    purchase_price: 4.99,
  },
  {
    id: "good-gather-pita",
    target_item_id: "54556324",
    target_product_url:
      "https://www.target.com/p/sea-salt-pita-chips-9oz-good-gather/-/A-54556324",
    purchase_price: 2.99,
  },
  {
    id: "apple-airtag",
    model_number: "AirTag",
    target_item_id: "54191097",
    upc_or_gtin: "194252096261",
    target_product_url: "https://www.target.com/p/apple-airtag/-/A-54191097",
    purchase_price: 29.0,
  },
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const out = {
  at: new Date().toISOString(),
  audit: "live-target-price-capability-prod-probe",
  base,
  health: null,
  agent_regression: null,
  products: [],
  searches_note:
    "Each A2MCP call may consume one SerpApi search on production when configured.",
  accepted_live_price: [],
};

// Health
{
  const r = await fetch(`${base}/health`);
  const body = await r.json();
  out.health = {
    status: r.status,
    serpapi_configured: body.serpapi_configured,
    provider_ready: body.provider_ready,
    body_keys: Object.keys(body),
  };
  console.log("health", out.health);
}

// POST /v1/agent frozen regression (expect 404 not_found for bogus purchase)
{
  const r = await fetch(`${base}/v1/agent`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "CHECK_MONITORING_STATUS",
      purchase_id: "pur_does_not_exist_audit",
    }),
  });
  const text = await r.text();
  out.agent_regression = {
    status: r.status,
    body_prefix: text.slice(0, 200),
    ok_frozen:
      r.status === 404 &&
      text.includes("not_found") &&
      !text.toLowerCase().includes("serpapi_api_key"),
  };
  console.log("agent", out.agent_regression);
}

for (const p of PRODUCTS) {
  await sleep(2500); // bound rate pressure
  const payload = {
    target_product_url: p.target_product_url,
    purchase_price: p.purchase_price,
    currency: "USD",
    purchase_date: "2026-07-01",
    country: "US",
    region: "TX",
    purchase_channel: "target_online",
  };
  if (p.model_number) payload.model_number = p.model_number;
  if (p.target_item_id) payload.target_item_id = p.target_item_id;
  if (p.upc_or_gtin) payload.upc_or_gtin = p.upc_or_gtin;

  const started = Date.now();
  let status;
  let body;
  try {
    const r = await fetch(`${base}/v1/target-price-check`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    status = r.status;
    body = await r.json();
  } catch (e) {
    status = 0;
    body = { error: String(e?.message || e) };
  }

  const row = {
    product_id: p.id,
    tcin: p.target_item_id,
    http_status: status,
    elapsed_ms: Date.now() - started,
    a2mcp_status: body.status ?? body.error ?? null,
    observed_price:
      body.observed_target_price ?? body.observed_price ?? null,
    purchase_price: body.purchase_price ?? null,
    potential_recovery: body.potential_recovery ?? null,
    matched_product: body.matched_product
      ? {
          title: body.matched_product.title ?? null,
          seller: body.matched_product.seller ?? null,
        }
      : null,
    raw_status_fields: {
      status: body.status ?? null,
      days_remaining: body.days_remaining ?? null,
      error: body.error ?? null,
    },
    price_source_type: body.price_source_type ?? null,
    provider: body.provider ?? null,
    has_disclaimer: Boolean(body.disclaimer),
    secret_leak: JSON.stringify(body).toLowerCase().includes("serpapi_api_key"),
    // A2MCP does not return per-candidate rejection diagnostics
    limitation:
      "Production A2MCP returns decision status only; granular candidate fields require local SerpApi key audit.",
  };
  out.products.push(row);
  console.log(
    JSON.stringify({
      product: p.id,
      http: status,
      status: row.a2mcp_status,
      price: row.observed_price,
    }),
  );

  const acceptedStatuses = new Set([
    "PRICE_DROP_DETECTED",
    "POTENTIALLY_ELIGIBLE",
    "NO_PRICE_DROP",
  ]);
  const observed =
    body.observed_target_price ?? body.observed_price ?? null;
  if (status === 200 && acceptedStatuses.has(body.status) && observed != null) {
    out.accepted_live_price.push({
      product_id: p.id,
      status: body.status,
      observed_price: observed,
    });
  }
}

if (out.accepted_live_price.length > 0) {
  out.gate3_verdict_from_a2mcp_only = "SERPAPI_TARGET_PRICE_CAPABILITY_PROVEN";
} else if (out.products.every((p) => p.http_status === 503)) {
  out.gate3_verdict_from_a2mcp_only = "PROVIDER_CONFIGURATION_BLOCKED_OR_RATE_LIMITED";
} else if (
  out.products.some(
    (p) =>
      p.a2mcp_status === "MATCH_REVIEW_REQUIRED" ||
      p.a2mcp_status === "NO_RELIABLE_PRICE",
  )
) {
  out.gate3_verdict_from_a2mcp_only =
    "LIVE_PROVIDER_REACHABLE_BUT_NO_SAFE_ACCEPTANCE_VIA_A2MCP";
  out.note =
    "SerpApi is live on production (not 503 config missing). Exact match path still fails closed for these products — local key required for Gate 1 field capture.";
} else {
  out.gate3_verdict_from_a2mcp_only = "INCONCLUSIVE";
}

fs.writeFileSync(
  path.join(proofDir, "prod-probe.json"),
  JSON.stringify(out, null, 2),
);
console.log(
  JSON.stringify(
    {
      verdict: out.gate3_verdict_from_a2mcp_only,
      accepted: out.accepted_live_price.length,
      products: out.products.map((p) => ({
        id: p.product_id,
        status: p.a2mcp_status,
      })),
    },
    null,
    2,
  ),
);
