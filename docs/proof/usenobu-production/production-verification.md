# UseNobu public verification

**URL:** https://usenobu.vercel.app  
**Project:** usenobu  
**Date:** 2026-07-13  

## Accessibility

| Check | Result |
|---|---|
| Public (no login / SSO) | Pass — direct HTTP 200 |
| Homepage brand | Nobu UI only |
| Prior brand in HTML | Absent |

## Endpoints

| Method / path | Status | Notes |
|---|---|---|
| GET / | 200 | “Bought it?”, “Track a Target purchase” |
| GET /purchases/new | 200 | Add purchase |
| GET /dashboard | 200 | Purchases list |
| GET /notices | 200 | How Nobu works |
| GET /health | 200 | `service: nobu-a2mcp`, `serpapi_configured: true` |
| POST /v1/target-price-check | 200 | Truthful structured status (e.g. MATCH_REVIEW_REQUIRED); disclaimer names Nobu; no secrets |

## Secrets

- No API keys in responses
- `serpapi_configured` is boolean only
