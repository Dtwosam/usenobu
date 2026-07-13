# AfterBuy Current State

**Date:** 2026-07-13  
**Status:** LANE 7 BLOCKED — FREE A2MCP IMPLEMENTED LOCALLY / PUBLIC HTTPS CURL PENDING

## Locked decisions

- Product: consumer price-drop protection (Target.com MVP).
- Free A2MCP one-time check first; **no x402 / wallet / payment work**.
- SerpApi = third-party observation, not official Target API.
- Fail-closed matching; no refund guarantees; Target decides.
- A2MCP is **stateless** (no SQLite as shared production persistence for the check).
- Primary implementation agent: Grok Build.

## Lanes 0–6 proof completed

- Source pack through consumer web flow (fixture-labelled E2E).

## Lane 7 status

### Implemented (local / unit-tested)

| Item | Status |
|---|---|
| OpenAPI-aligned request/response schemas | Done (`src/a2mcp/schemas.ts`) |
| `GET /health` | Done (`app/health/route.ts`) |
| `POST /v1/target-price-check` | Done (`app/v1/target-price-check/route.ts`) |
| Input validation (strict; sensitive fields rejected) | Done |
| Rate limiting (in-process sliding window) | Done |
| Reuses policy + matching engines | Done |
| Server-side SerpApi client when key present | Done |
| Safe audit log (no bodies/keys) | Done |
| Unit tests (`tests/a2mcp/`) | **Pass** |

### Blocked (full Lane 7 proof)

| Item | Status |
|---|---|
| Public HTTPS deployment | **Blocked** — no Vercel/Fly CLI or deploy token in environment |
| External curl over HTTPS | **Not proven** |
| Live SerpApi in production | Key not required for unit proof; required for live provider responses |

**Exact blockers:**

1. No production hosting credentials / CLI for public HTTPS URL.  
2. External HTTPS curl cannot be produced until (1) is resolved.

Evidence notes: `docs/proof/a2mcp/local-endpoint-proof.md`

## Remaining later gates

1. Deploy free A2MCP over public HTTPS; archive external curl (Lane 7 closeout).  
2. OKX ASP registration/listing (Lane 8).  
3. Demo and submission (Lane 9).

## Next active lane

**Lane 7 (continue)** — complete public HTTPS deployment and external curl proof.  
Then: **Lane 8 — OKX ASP registration and live listing.**
