# Nobu Current State

**Date:** 2026-07-13  
**Status:** LANE 7.5D COMPLETE / UNIVERSAL PLATFORM POSITIONING

## Locked decisions

- Product name: **Nobu**
- Public deployment identity: **UseNobu**
- Vercel project: **usenobu**
- Production URL: **https://usenobu.vercel.app**
- Platform: universal post-purchase price-monitoring design
- **First and only live retailer:** Target.com / Target app (U.S. MVP scope)
- Free A2MCP one-time check first; no x402/wallet work until free listing is stable.
- SerpApi third-party observation only for Target; never official Target API.
- Fail-closed matching; no refund guarantees; retailer decides (Target for live integration).
- Stateless A2MCP check path for Target endpoint.
- Primary implementation agent: Grok Build.

## Production

| Item | Value |
|---|---|
| Public production URL | **https://usenobu.vercel.app** |
| Deployment identity | UseNobu |
| Health service | `nobu-a2mcp` |
| Live retailer | Target only |

Public A2MCP routes (unchanged):

- `GET /health`
- `POST /v1/target-price-check`

## Lane 7.5D proof completed

| Item | Result |
|---|---|
| Universal homepage positioning | Yes |
| Target labelled as currently supported | Yes |
| Primary CTA | `Track a purchase` |
| No fake multi-retailer claims | Yes |
| Target policy/matching/API | Unchanged |

## Hard locks (unchanged)

- Target only live; Target Plus excluded; U.S. excluding AK/HI unless later verified.
- No retailer login, claim submission, card/banking/ID/wallet secrets.

## Next active lane

**Lane 8 — OKX ASP registration and live listing.**
