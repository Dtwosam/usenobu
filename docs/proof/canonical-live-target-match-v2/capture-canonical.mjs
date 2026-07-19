/**
 * One bounded canonical AirTag request — writes full response to disk.
 * Does not print large bodies to the terminal.
 */
import fs from "node:fs";
import path from "node:path";

const dir = path.resolve("docs/proof/canonical-live-target-match-v2");
fs.mkdirSync(dir, { recursive: true });

const bases = [
  "https://usenobu.vercel.app",
  // Retired legacy alias intentionally omitted from current proof runs.
];

const body = {
  target_product_url:
    "https://www.target.com/p/apple-airtag/-/A-54191097",
  purchase_price: 35,
  currency: "USD",
  purchase_date: "2026-07-01",
  country: "US",
  region: "TX",
  purchase_channel: "target_online",
  model_number: "AirTag",
  target_item_id: "54191097",
  upc_or_gtin: "194252096261",
};

const acceptedStatuses = new Set([
  "PRICE_DROP_DETECTED",
  "POTENTIALLY_ELIGIBLE",
  "NO_PRICE_DROP",
]);

function baseSlug(base) {
  return base.replace(/^https?:\/\//, "").replace(/\./g, "-");
}

const meta = {
  at: new Date().toISOString(),
  product: "Apple AirTag",
  purchase_price: 35,
  tcin: "54191097",
  health: [],
  canonical: null,
};

for (const base of bases) {
  try {
    const h = await fetch(`${base}/health`, {
      signal: AbortSignal.timeout(15_000),
    });
    const hj = await h.json();
    const rec = {
      base,
      status: h.status,
      serpapi_configured: hj.serpapi_configured,
      provider_ready: hj.provider_ready,
    };
    meta.health.push(rec);
    fs.writeFileSync(
      path.join(dir, `health-${baseSlug(base)}.json`),
      JSON.stringify({ status: h.status, body: hj }, null, 2),
    );
  } catch (e) {
    meta.health.push({ base, error: String(e?.message || e) });
  }
}

let captured = false;
for (const base of bases) {
  if (captured) break;
  try {
    const started = Date.now();
    const r = await fetch(`${base}/v1/target-price-check`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    const text = await r.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = { parse_error: true, raw_text_prefix: text.slice(0, 800) };
    }

    const full = {
      at: new Date().toISOString(),
      base,
      http_status: r.status,
      elapsed_ms: Date.now() - started,
      content_type: r.headers.get("content-type"),
      request: {
        ...body,
        // identifiers only — no secrets
      },
      body: json,
      secret_leak: /serpapi_api_key|gsk_|api_key=[a-z0-9]{8,}/i.test(text),
    };
    fs.writeFileSync(
      path.join(dir, "canonical-airtag-response.json"),
      JSON.stringify(full, null, 2),
    );

    const status = json?.status ?? null;
    const observed = json?.observed_target_price ?? null;
    const summary = {
      at: full.at,
      base,
      http_status: r.status,
      status,
      observed_target_price: observed,
      potential_recovery: json?.potential_recovery ?? null,
      matched_product: json?.matched_product ?? null,
      provider: json?.provider ?? null,
      price_source_type: json?.price_source_type ?? null,
      days_remaining: json?.days_remaining ?? null,
      has_disclaimer: Boolean(json?.disclaimer),
      match_evidence:
        json?.matched_product?.match_evidence ??
        json?.matched_product?.match_tier ??
        null,
      secret_leak: full.secret_leak,
      accepted:
        r.status === 200 &&
        acceptedStatuses.has(status) &&
        observed != null &&
        observed > 0,
      provider_calls_note:
        "One POST /v1/target-price-check; server may use 1 shopping + 0–1 immersive",
    };
    fs.writeFileSync(
      path.join(dir, "canonical-airtag-summary.json"),
      JSON.stringify(summary, null, 2),
    );
    meta.canonical = summary;
    captured = true;
  } catch (e) {
    meta.errors = meta.errors || [];
    meta.errors.push({ base, error: String(e?.message || e) });
  }
}

fs.writeFileSync(path.join(dir, "phase1-meta.json"), JSON.stringify(meta, null, 2));

// Small terminal output only
console.log(
  JSON.stringify(
    {
      captured,
      accepted: meta.canonical?.accepted ?? false,
      status: meta.canonical?.status ?? null,
      price: meta.canonical?.observed_target_price ?? null,
      base: meta.canonical?.base ?? null,
      http: meta.canonical?.http_status ?? null,
    },
    null,
    2,
  ),
);
process.exit(meta.canonical?.accepted ? 0 : 1);
