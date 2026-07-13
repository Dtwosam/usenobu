# AfterBuy Current State

**Date:** 2026-07-13  
**Status:** LANE 4 COMPLETE / FAIL-CLOSED PRODUCT MATCHING AND CONFIRMATION

## Locked decisions

- Product: consumer price-drop protection, not a merchant Shopify app.
- Retailer: Target (Target.com / online only); Target Plus excluded.
- Price source: SerpApi Google Shopping (third-party observation, **not** an official Target API).
- **SerpApi `product_id` is never treated as Target TCIN.**
- Match model: Target-seller-only candidates; strong identity hierarchy; user confirms once; locked fingerprint for all later checks.
- Title-only similarity cannot confirm or lock a match.
- Ambiguous multi-Target strong candidates return `MATCH_REVIEW_REQUIRED` (not exact).
- Policy engine: deterministic Target policy (Lane 2 complete).
- Primary implementation agent: Grok Build.

## Lane 0–3 proof completed

- Source pack, domain schemas, migrations, Target policy engine, SerpApi connector + live capability audit.

## Lane 4 proof completed

### Matching engine (`src/matching/`)

| Capability | Status |
|---|---|
| Target-seller-only candidate generation | Done |
| Fail-closed reject non-Target / Target Plus | Done |
| Hierarchy: Target URL → TCIN → model+variant → UPC | Done |
| Title-only → `MATCH_REVIEW_REQUIRED` (never lock) | Done |
| Ambiguous multiple strong candidates → review | Done |
| User confirmation required before lock | Done |
| Stable locked fingerprint + DB persistence | Done |
| Later-offer check against locked fingerprint | Done |

### Migration

- `0002_matching`: matching columns on `product_matches` + `product_fingerprints` table.
- Apply/reverse/re-apply covered in migration tests.

### Tests

- Exact URL/TCIN and model+variant pass as `EXACT_MATCH_CANDIDATE` (confirmation still required).
- Wrong model, wrong seller, Target Plus, variant mismatch fail closed.
- Ambiguous multi-Target and title-only fail closed.
- Confirmation creates stable fingerprint; purchase → `MONITORING_ACTIVE` with `fingerprint_id`.
- No live SerpApi searches, no monitoring loop, no UI.

## Remaining later gates

1. Price monitoring loop (Lane 5).
2. Consumer UI, free A2MCP endpoint, OKX listing, demo/submission.

## Risk register snapshot

- Live Google Shopping may return multiple Target rows → must stay review-required until user confirmation.
- Merchant Target.com deep links may be missing; fingerprint may rely on purchase Target URL + TCIN/model.
- Free-plan SerpApi capacity remains limited.

## Next active lane

**Lane 5 — Price monitoring loop.**
