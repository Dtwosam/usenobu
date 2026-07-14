# Nobu Canonical Live Match Repair v2 Proof

**Date:** 2026-07-14  
**Verdict:** `NOBU_CANONICAL_LIVE_MATCH_PASS`

## Repair (already implemented before this closeout)

- Canonical and monitoring paths share `TargetMatchFingerprint` shape.
- Canonical query uses `buildMonitorShoppingQuery`.
- Canonical match uses `evaluateObservationAgainstFingerprint` → `offerMatchesLockedFingerprint`.
- Seller, ambiguity, accessory, wrong-model, and title-only rejection gates retained.
- SerpApi/Google `product_id` is never TCIN.

## Final call graph

| Path | Query builder | Matcher |
|---|---|---|
| `POST /v1/target-price-check` | `buildMonitorShoppingQuery` | `evaluateObservationAgainstFingerprint` |
| Browser `Check price now` | `buildMonitorShoppingQuery` | same evaluator via `runMonitoringPass` |

## Phase 1 — Canonical AirTag capture

One bounded request, response written to disk (no PowerShell body pipeline).

| Field | Value |
|---|---|
| Base | `https://usenobu.vercel.app` |
| HTTP | **200** |
| Status | **`PRICE_DROP_DETECTED`** |
| Observed price | **$29.99** |
| Potential recovery | $5.01 (vs $35 purchase) |
| Seller | Target |
| Match tier | `exact_model_variant` |
| Match evidence | `model_from_title`, `title_sim=1.000` |
| Provider | SerpApi |
| Price source | `THIRD_PARTY_SEARCH_OBSERVATION` |
| Secret leak | false |
| Accepted | **true** |

Files:

- `canonical-airtag-response.json` — full redacted body
- `canonical-airtag-summary.json` — slim summary
- `capture-canonical.mjs` — capture harness

### Provider consumption

- Canonical endpoint requests: **1**
- Upper bound SerpApi searches for that request: 1 Shopping + optional 1 immersive

## Local verification (pre-closeout)

| Command | Result |
|---|---|
| `npm test` | 230 tests passed |
| `npm run typecheck` | passed |
| `npm run build` | passed |

## Production

- Deployment noted: `dpl_3wh1eiWcTg3YLw8HEFbdpvuCQPbX`
- Primary alias: `https://usenobu.vercel.app`
- `GET /v1/capability-audit`: 404 (expected after removal from public surface)
- `POST /v1/agent`: frozen (404 `not_found`)

## Remaining (not this commit)

Browser enrollment still uses fixture discovery (`buildFixtureOffers`) for
`Find my product` / confirm. Canonical acceptance is proven; live enrollment is
a separate repair.

Lane 8 remains pending review. ASP agent **5541** and `POST /v1/agent` frozen.
