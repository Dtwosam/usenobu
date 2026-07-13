# Nobu Current State

**Date:** 2026-07-13  
**Status:** LANE 7.5D.1 COMPLETE / FIND-PRODUCT PRODUCTION REPAIR

## Locked decisions

- Product name: **Nobu**
- Public deployment identity: **UseNobu**
- Vercel project: **usenobu**
- Production URL: **https://usenobu.vercel.app**
- Platform positioning: universal post-purchase monitoring; **Target is the only live retailer**
- Free A2MCP first; SerpApi third-party Target observation only
- Fail-closed matching; no refund guarantees

## Production note (corrected)

Earlier 7.5D production checks covered static pages and `/health` only. The **Find my product** server action was **broken in production** (ENOENT scandir migrations → blank Application error). That is repaired in Lane 7.5D.1.

| Item | Value |
|---|---|
| Public production URL | **https://usenobu.vercel.app** |
| Health | `nobu-a2mcp` |
| Find my product | Verified in real browser (POST 303 → review 200) |
| Repair proof | `docs/proof/usenobu-production/find-product-repair/` |

Public A2MCP routes (unchanged):

- `GET /health`
- `POST /v1/target-price-check`

## Lane 7.5D.1 root cause

`src/db/migrator.ts` called `fs.readdirSync` on a migrations directory not present in the Vercel serverless bundle. First SQLite open/migrate during form submit crashed.

## Hard locks (unchanged)

- Target-only live integration; no other retailers
- No policy/matching/monitoring/API contract changes

## Next active lane

**Lane 8 — OKX ASP registration and live listing.**
