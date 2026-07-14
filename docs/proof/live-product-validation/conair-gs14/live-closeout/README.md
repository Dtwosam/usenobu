# A.3 — Policy freshness + live match closeout (Conair GS14)

**Date:** 2026-07-14  
**Verdict:** `NOBU_REVIEW_SAFE_A_3_PASS`  
**Production:** https://usenobu.vercel.app  

## Official policy re-verification

| Item | Value |
|---|---|
| Source | https://www.target.com/help/articles/policies-guidelines/price-match-guarantee |
| Summary article | https://www.target.com/help/article/000062256 |
| Verified at (Nobu snapshot) | **2026-07-14T20:00:00.000Z** |
| Material policy changes | **None** vs locked contract |

Confirmed still:

- 14-day window after purchase  
- Identical item / brand / size / weight / color / quantity / model  
- Target verifies listed price; may decline if not verified  
- AK/HI exclusions for Target.com / app price match  
- Target Plus separate rules (MVP excludes Target Plus)  
- Guest Services **1-800-591-3869**; online chat for Target.com orders  
- Screenshots not accepted as final proof  

Registry updated: `TARGET-POLICY`, `TARGET-SUMMARY` last checked **2026-07-14**.

## Policy freshness fix

`TARGET_US_POLICY.verified_at` and YAML `verified_at` refreshed from `2026-07-13` → **`2026-07-14T20:00:00Z`** so the 24h freshness gate no longer returns `POLICY_STALE` on production.

## Live Conair closeout (one manual check)

| Field | Result |
|---|---|
| Product | Conair ExtremeSteam Handheld Garment Steamer |
| Model / TCIN / UPC | GS14 / 87470797 / 074108469755 |
| `data_source` | **LIVE** |
| Outcome | **`no_match`** (fail-closed after live path — not generic unexplained only; not fixture) |
| Alert | **None** (no false positive) |
| POLICY_STALE | **No** |
| A2MCP one-shot (same product) | **MATCH_REVIEW_REQUIRED** via SerpApi (proves connector + not stale) |
| API key exposed | **No** |

Acceptable under A.3: specific non-positive live result after reaching SerpApi/matcher. Price drop not required.

Screenshot: `after-live-check.png`  
Machine record: `live-closeout.json`

## Tests

- `tests/policy/freshness.test.ts`  
- Full `npm test` (222)  
- typecheck / build  
- Secret scan  

## Lane 8

Still **NOBU_LANE_8_PENDING_REVIEW** (ASP #5541). No ASP resubmit.
