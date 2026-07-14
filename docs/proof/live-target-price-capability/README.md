# Live Target Price Capability Audit

**Date:** 2026-07-14  
**Verdict:** `SERPAPI_TARGET_PRICE_CAPABILITY_PROVEN`  
**ASP Agent ID:** `5541` (unchanged)  
**Lane 8:** still pending review  
**POST /v1/agent:** frozen (404 not_found regression)

## Problem

Real Target products (Conair GS14, Dyson V8) returned “Nobu could not confirm the exact product.” A system that fails closed on every live observation cannot prove the core product promise.

## Gate 1 — Provider capability (live SerpApi)

Runtime audit via production secrets (`GET /v1/capability-audit` on the production deployment; SerpApi key is not pullable to local CLI).

| Product | Query | Provider status | Results | Target sellers | Notes |
|---|---|---|---|---|---|
| Conair GS14 | `Conair GS14 87470797 Target` | AMBIGUOUS_TARGET_RESULTS | 40 | 31 | Google-only links; no TCIN on Shopping rows |
| Apple AirTag | `Apple AirTag 54191097 Target` | AMBIGUOUS_TARGET_RESULTS | varies | ≥4 Target | Exact title + Target seller + price |
| up&up acetaminophen | (prod-probe / A2MCP) | MATCH_REVIEW_REQUIRED | — | — | Fail closed |

**Fields actually returned by SerpApi Google Shopping (new layout):**

- `title`, `source` (e.g. `"Target"`), `price` / `extracted_price`
- `product_id` (Google catalog id — **never** used as TCIN)
- `product_link` / Google hosts only
- `immersive_product_page_token` (when present)
- **Usually missing:** direct `target.com` merchant `link`, structured model, UPC, TCIN

## Gate 2 — Rejection causes (not collapsed)

| Cause | Seen on |
|---|---|
| `no_direct_target_url_google_only_link` | Nearly all Target-sourced Shopping rows |
| `tcin_missing_on_offer` | Same |
| `model_missing_on_offer_structured` | Same |
| `upc_missing_on_offer_structured` | Same |
| `insufficient_identity_for_locked_fingerprint` | Conair (model not in title) |
| Accessory false model (pre-repair) | AirTag Loop Case / keychains — **now rejected** |

## Gate 3 — Verdict

**`SERPAPI_TARGET_PRICE_CAPABILITY_PROVEN`**

### Accepted live observation (required)

| Field | Value |
|---|---|
| Product | Apple AirTag |
| Seller | Target (`seller_kind=target`) |
| Title | `Apple AirTag` |
| Price | `$29.99` |
| Match path | `model_from_title` + `title_sim=1.000` |
| Identity | Locked model `AirTag` appears as title token; title similarity 1.0 vs fingerprint |
| Provenance | Live SerpApi Google Shopping; third-party observation |
| Fixture | No |
| Ambiguity | Accessories with “AirTag” in title rejected after repair |

### Matching evidence path

1. User-confirmed locked fingerprint (Target URL + TCIN + model + title).
2. `buildMonitorShoppingQuery` → brand/model/TCIN + `Target`.
3. `searchShopping` → normalize → `toMatchableOffer`.
4. Optional one immersive enrich only when no match yet **and** recovered TCIN matches expected (fail closed otherwise).
5. `offerMatchesLockedFingerprint`: URL → TCIN → model (structured or title+high sim) → UPC.

### Negative products (still safely rejected)

1. **Conair GS14** — Target prices exist, but Shopping titles omit `GS14` and direct Target URLs; immersive must not attach a different TCIN (Fabric Steamer A-1011636045 ≠ 87470797).
2. **AirTag accessories** — model token alone is insufficient without high title similarity.
3. **up&up acetaminophen** — A2MCP `MATCH_REVIEW_REQUIRED` (no strong identity on Google-only rows; no model on fingerprint).

## Repairs made (allowed only after proof)

1. **Query:** include TCIN as compact secondary when model is primary.
2. **Model-from-title gate:** require title similarity ≥ 0.72 vs locked product title (blocks accessories).
3. **Enrollment multi-strong fix:** same identity among duplicates → single exact candidate.
4. **Immersive enrichment (bounded, 1 search):** recover Target.com URL/TCIN when Shopping is Google-only; **only apply** if recovered TCIN matches expected TCIN.
5. **Diagnostics:** granular rejection causes; temporary `GET /v1/capability-audit` for redacted field capture (not OpenAPI A2MCP; not agent contract).

## What was not done

- No title-only acceptance.
- Google product id never treated as TCIN.
- No Target scrape, no second retailer.
- No weakening of fail-closed for ambiguous identity.
- Sprint A / A.1 / A.2 / A.3 still prove safe execution and diagnostics — **this audit** proves at least one live accepted Target price.

## Remaining product gap

**Conair GS14** and many model-less SKUs still fail when SerpApi omits Target URLs and the model string is absent from the Shopping title. Capability is proven on AirTag; coverage is not universal.

## Search count (this audit window)

- Capability-audit runtime: 3 searches (Shopping ± immersive) for 2 products in the successful pass.
- Prod A2MCP multi-product probe: additional bounded checks (see `prod-probe.json`).
- Local `vercel env pull` cannot read encrypted `SERPAPI_API_KEY` (empty string) — runtime production is configured (`serpapi_configured: true`).

## Tests

- `npm test` — 226+ tests
- Targeted: matcher, immersive enrich, normalize
- `npm run typecheck`
- `npm run build`
- Secret scan: no API keys in proof JSON
- `/health` ok; `POST /v1/agent` frozen 404

## Files

- `docs/proof/live-target-price-capability/capability-audit-runtime.json`
- `docs/proof/live-target-price-capability/prod-probe.json`
- `docs/proof/live-target-price-capability/run-capability-audit.mjs`
- `docs/proof/live-target-price-capability/prod-probe.mjs`
- Code: immersive enrich, matcher gates, live-monitor, A2MCP check path
