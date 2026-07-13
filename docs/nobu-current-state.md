# Nobu Current State

**Date:** 2026-07-13  
**Status:** LANE 7.5B3 COMPLETE / POLISH + PRODUCTION DEPLOY

## Locked decisions

- Product name: **Nobu** (prior brand archives only under `docs/proof/historical-afterbuy/`).
- Consumer price-drop protection for Target.com MVP.
- Free A2MCP one-time check first; no x402/wallet work until free listing is stable.
- SerpApi third-party observation only; never official Target API.
- Fail-closed matching; no refund guarantees; Target decides.
- Stateless A2MCP check path (no SQLite as shared production persistence for the endpoint).
- Primary implementation agent: Grok Build.

## Production

| Item | Value |
|---|---|
| Public production URL | **https://afterbuy.vercel.app** |
| Health service | `nobu-a2mcp` |
| Preferred `nobu.vercel.app` | Unavailable (third-party in use) |
| Extra Nobu aliases | Created but SSO-protected (not public) |

Public A2MCP routes (unchanged):

- `GET /health`
- `POST /v1/target-price-check`

## Lane 7.5B3 proof completed

| Item | Result |
|---|---|
| Visual QA checklist | `docs/proof/ui/final/qa-checklist.md` |
| Final screenshots | `docs/proof/ui/final/` |
| Header responsive fix | Desktop CTA only; mobile menu only |
| Raw enum UI | Hidden; plain-English labels only |
| axe serious/critical | 0 on key routes |
| Production health | `nobu-a2mcp`, SerpApi configured |
| Production A2MCP POST | Truthful structured JSON |
| Domain / API / matching | Unchanged |

## Hard locks (unchanged)

- Target only; Target Plus excluded; U.S. excluding AK/HI unless later verified.
- No retailer login, claim submission, card/banking/ID/wallet secrets.

## Next active lane

**Lane 8 — OKX ASP registration and live listing.**
