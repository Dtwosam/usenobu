# Live Discovery Deduplication / Ambiguity Repair

**Date:** 2026-07-15
**Verdict:** `NOBU_DISCOVERY_DEDUP_PASS`

## Proven root cause

**`MULTIPLE_CAUSES`**

1. **`IDENTIFIER_LOST_BEFORE_DISCOVERY`** — New-purchase form defaults seeded **Example Widget** TCIN `87654321` / URL. AI fill only overwrote when extract returned values, so the AirTag sentence often never reached discovery.
2. **`AMBIGUITY_UI_DEFECT`** — `MATCH_REVIEW_REQUIRED` always showed “add a model, TCIN or UPC” even when identifiers were already stored (or when the reason was `no_strong_match` with zero candidates).
3. **Duplicate-offer risk** — Multiple strong Target offers for the same SKU could be treated as separate identities when keys mixed TCIN vs model vs Google product id. Fixed by compatible grouping (never Google product id).

## Gate 1 — Identifier survival (post-repair production)

| Field | Value | Survives |
|---|---|---|
| Form TCIN | `54191097` | yes |
| Target URL | `…/A-54191097` | yes |
| Model | `AirTag` | yes |
| Title | `Apple AirTag` | yes |
| Discovery source | LIVE | yes |

## Gate 2 — Classification

| Result | Detail |
|---|---|
| Decision | `EXACT_MATCH_CANDIDATE` |
| Candidates shown | **1** — Apple AirTag |
| Ambiguous UI | no |
| Asks add TCIN | no |

## Repair

| Area | Change |
|---|---|
| Form defaults | Empty — no Example Widget IDs |
| AI fill | Clears demo placeholders before applying extract |
| Matching | Compatible strong-candidate groups; collapse duplicate offers to one representative |
| UI candidates | Exact match lists the single representative only |
| Ambiguity copy | Does not ask for TCIN when TCIN already stored |
| Session cookie | Keeps fingerprint + match FK after confirm (monitoring) |

## Production proof (`https://www.usenobu.xyz`)

1. AirTag identifiers → Find my product
2. **One** LIVE candidate: Apple AirTag
3. Confirm → monitoring
4. Check price now → **`price_drop` / `data_source: LIVE`**
5. No 404, no fixture, no “add TCIN” copy

`production-proof.json`

## Tests

- Dedup + accessory negatives
- Ambiguity-copy
- Live discovery + navigation
- `npm test` **248** pass
- typecheck + build pass

## Hard locks

Matching thresholds not weakened; no title-only; accessories not merged as main product; Google product id never TCIN; `/v1/agent` and ASP `5541` unchanged.
