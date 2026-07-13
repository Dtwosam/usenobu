# AfterBuy Current State

**Date:** 2026-07-13  
**Status:** LANE 7 COMPLETE / PUBLIC FREE A2MCP ENDPOINT PROVED

## Locked decisions

- Product: consumer price-drop protection (Target.com MVP).
- Free A2MCP one-time check first; **no x402 / wallet / payment work**.
- SerpApi = third-party observation, not official Target API.
- Fail-closed matching; no refund guarantees; Target decides.
- A2MCP is **stateless** (no SQLite as shared production persistence for the check).
- Primary implementation agent: Grok Build.

## Lanes 0–6 proof completed

- Source pack through consumer web flow (fixture-labelled E2E).

## Lane 7 proof completed

### Public HTTPS

| Item | Value |
|---|---|
| Base URL | **https://afterbuy.vercel.app** |
| `GET /health` | **HTTP 200** JSON |
| Valid OpenAPI `POST /v1/target-price-check` | **HTTP 503** structured `DATA_SOURCE_UNAVAILABLE` when live provider unavailable (no invented prices) |
| Invalid input | **HTTP 400** |
| Fail-closed (AK) | **HTTP 200** `UNSUPPORTED_PURCHASE` |
| Ambiguous/weak path | **HTTP 200** `MATCH_REVIEW_REQUIRED` |
| Rate limit | **HTTP 429** observed |
| Secret leakage | **None** in archived curl bodies |

Evidence: `docs/proof/a2mcp/external-https-closeout.md`, `docs/proof/a2mcp/external-curl-summary-latest.json`, redacted `curl-*.json` files.

### Implementation

- OpenAPI routes: `app/health/route.ts`, `app/v1/target-price-check/route.ts`
- Service: `src/a2mcp/` (validation, rate limit, audit, policy+matching reuse)
- Unit tests: `tests/a2mcp/a2mcp.test.ts` (includes 200 price-drop when offers injected)

### Optional follow-up (not a Lane 7 blocker)

- Configure `SERPAPI_API_KEY` on Vercel for live provider 200 price observations (never commit the key).

## Remaining later gates

1. OKX ASP registration and live listing (Lane 8).  
2. Demo and submission closeout (Lane 9).

## Next active lane

**Lane 8 — OKX ASP registration and live listing.**
