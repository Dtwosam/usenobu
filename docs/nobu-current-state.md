# Nobu Current State

**Date:** 2026-07-13  
**Status:** LANE 7.5C COMPLETE / USENOBU PRODUCTION

## Locked decisions

- Product name: **Nobu**
- Public deployment identity: **UseNobu**
- Vercel project: **usenobu**
- Production URL: **https://usenobu.vercel.app**
- Consumer price-drop protection for Target.com MVP.
- Free A2MCP one-time check first; no x402/wallet work until free listing is stable.
- SerpApi third-party observation only; never official Target API.
- Fail-closed matching; no refund guarantees; Target decides.
- Stateless A2MCP check path (no SQLite as shared production persistence for the endpoint).
- Primary implementation agent: Grok Build.

## Production

| Item | Value |
|---|---|
| Public production URL | **https://usenobu.vercel.app** |
| Deployment identity | UseNobu |
| Health service | `nobu-a2mcp` |
| Proof archive | `docs/proof/usenobu-production/` |

Public A2MCP routes (unchanged):

- `GET /health`
- `POST /v1/target-price-check`

## Lane 7.5C proof completed

| Item | Result |
|---|---|
| Prior-brand working-tree scan | Empty |
| Historical prior-brand folder | Removed from working tree (Git history retains past commits) |
| OpenAPI production server | `https://usenobu.vercel.app` |
| Public accessibility | No Vercel login/SSO required |
| Health / A2MCP | Verified on UseNobu URL |
| Domain / API / matching | Unchanged |

## Hard locks (unchanged)

- Target only; Target Plus excluded; U.S. excluding AK/HI unless later verified.
- No retailer login, claim submission, card/banking/ID/wallet secrets.

## Next active lane

**Lane 8 — OKX ASP registration and live listing.**
