# Lane 7 production readiness repair

**Date:** 2026-07-13  
**Public URL:** `https://afterbuy.vercel.app`

## Root cause

Schema-valid production requests returned **`503 DATA_SOURCE_UNAVAILABLE`** because:

1. `runA2mcpTargetPriceCheck` calls `createSerpApiClientFromEnv()`.
2. When `SERPAPI_API_KEY` is missing or empty in the Vercel runtime, the client is `null`.
3. The service correctly refuses to invent prices and returns **503** (not fake live data).

`SERPAPI_API_KEY` was later present on **Vercel Production** (encrypted). A production redeploy was required so runtime could read the key. After redeploy:

- `/health` reports `serpapi_configured: true` / `provider_ready: true` (boolean only; **no key value**).
- Valid POSTs reach SerpApi and return **HTTP 200** with a truthful structured status.

## Code hardening

- Health: boolean provider readiness (no secrets).
- Check service: clearer non-secret disclaimers when key missing vs provider error.
- Client: treat empty/whitespace keys as unconfigured; accept `SERP_API_KEY` alias if ever set.

## Live searches consumed (this repair)

| # | Purpose | Result |
|---|---|---|
| 1 (diagnostic) | Confirm key path | HTTP 200 `MATCH_REVIEW_REQUIRED` |
| 1 (archived) | Formal proof, proven up&up product | HTTP 200 `MATCH_REVIEW_REQUIRED` |

**Total ≤ 2.** Fail-closed AK + invalid input used **0** SerpApi searches.

## Archived production curl (redacted)

- `docs/proof/a2mcp/repair-curl-health-*.json`
- `docs/proof/a2mcp/repair-curl-valid-live-upup-*.json`
- `docs/proof/a2mcp/repair-curl-fail-closed-ak-*.json`
- `docs/proof/a2mcp/repair-curl-invalid-*.json`
- `docs/proof/a2mcp/repair-production-readiness-summary.json`

## Truthfulness

- Live multi-Target house-brand observation → **`MATCH_REVIEW_REQUIRED`** (fail closed; not exact match).
- **Not** labelled as fixture; provider path is real SerpApi when configured.
- No refund guarantees; Target final decision retained in disclaimer.
