# Lane 3 repair analysis (bounded live audit)

**Date:** 2026-07-13  
**Provider:** SerpApi Google Shopping (`engine=google_shopping`)  
**Classification:** third-party observation — **not** an official Target API  

## Prior live query (already consumed)

| Field | Value |
|---|---|
| Query | `Apple AirPods Pro 2 USB-C Target` |
| Offers | 40 |
| Target-sold offers | **0** |
| Status | `NO_TARGET_RESULT` |
| Seller mix | Whatnot, eBay, Poshmark, Walmart, etc. |
| Link shape | **All** `www.google.com` product links (no merchant/direct Target.com URLs) |
| UTF-8 | Some titles showed mojibake / odd encoding in redacted fixture |

Root cause of failure (evidence-based):

1. Broad “title + Target” shopping query still returned **marketplace-dominated** offers; Google Shopping did not surface `source: Target` in that result set.
2. New Shopping layout often returns only Google product pages on `product_link` / `link`, not merchant deep links — so Target.com URLs were **not available** on that page.
3. No Target store filter token was captured in the redacted proof (filters not present in that artifact).

## Connector repairs implemented (offline)

| Repair | Purpose |
|---|---|
| `shoprs` query parameter | Support Shopping Filters tokens per SerpApi docs |
| Filter / `target_shoprs_tokens` extraction | Detect Target store filter when SerpApi returns it |
| `merchant_link` vs Google `product_link` | Capture real merchant URLs only when non-Google host returned |
| UTF-8 title decode + `title_utf8_ok` | Detect/repair mojibake; verify title encoding |
| Exact product audit plan | Model/title queries instead of broad “… Target” |
| Max-4 search repair CLI | `npm run serpapi:repair-audit` |
| Lane 3 pass criteria helper | Target seller + usable price + identity evidence |

## Bounded repair live audit (completed)

| Item | Result |
|---|---|
| Verdict | **`AFTERBUY_LANE_3_PASS`** |
| New live searches | **2** (of max 4) |
| Query 1 | `Apple AirPods Pro MTJV3AM/A` → `NO_TARGET_RESULT` (40 offers, 0 Target) |
| Query 2 | `up&up acetaminophen 500 mg 100 tablets` → **8 Target offers**, `AMBIGUOUS_TARGET_RESULTS` |
| Pass basis | Target seller + price + identity (title UTF-8 OK, product_id); **not** an exact match |
| Target shoprs | Discovered in response filters (tokens present; not required for pass) |
| Merchant Target.com deep links | **Missing** on live layout (Google product links only) |
| Summary artifact | `docs/proof/serpapi/repair-audit-summary.json` |

## Fields (live repair pass query)

| Field | Available live |
|---|---|
| Target seller (`source: Target`) | **Yes** (8 rows) |
| Usable price | **Yes** (e.g. 1.99–14.99 USD) |
| Merchant/direct Target URL | **No** |
| Google product_link | **Yes** |
| product_id (Google/SerpApi) | **Yes** (not TCIN) |
| TCIN first-class | **Not proven** |
| Model/UPC first-class | **Not proven** as dedicated fields |
| Target shoprs token | **Yes** (filter tokens present) |
| UTF-8 title | **Yes** (`title_utf8_ok`) |

## SerpApi viability conclusion

**Viable for MVP third-party Target observation** when queries use exact product identity (e.g. Target house-brand titles). Broad electronics queries may still return zero Target sellers. Multiple Target rows must remain `AMBIGUOUS_TARGET_RESULTS` until Lane 4 fail-closed matching and user confirmation. Merchant deep links may be absent; identity for monitoring will rely on seller + title + product_id / immersive token / later confirmation.

## Lane 3 pass gate (met)

1. Live Target-sold offer(s) with `seller_kind = target`  
2. Usable `extracted_price`  
3. Identity evidence (UTF-8 title + product_id)  
4. Multi-Target result correctly classified as **ambiguous**, not exact match  

## Next exact step

**Lane 4 — Candidate matching and product confirmation.**
