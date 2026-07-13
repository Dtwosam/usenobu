# Lane 7 A2MCP local proof

**Date:** 2026-07-13  
**Status:** Implementation tested in-process; **public HTTPS external curl blocked**

## Endpoints (OpenAPI)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Service health → HTTP 200 JSON |
| `POST` | `/v1/target-price-check` | Free one-time Target price check |

Contract: `openapi/afterbuy-a2mcp.openapi.yaml`  
Implementation: `src/a2mcp/`, routes `app/health/route.ts`, `app/v1/target-price-check/route.ts`

## In-process unit proof (`npm test` — `tests/a2mcp/a2mcp.test.ts`)

| Case | Result |
|---|---|
| Valid exact match + lower price | HTTP **200**, `PRICE_DROP_DETECTED`, recovery calculated |
| Invalid currency / channel / sensitive fields | Rejected (**400** path for invalid schema) |
| Ambiguous multi-Target offers | HTTP **200**, `MATCH_REVIEW_REQUIRED` (fail closed) |
| Alaska region | HTTP **200**, `UNSUPPORTED_PURCHASE` |
| Provider forced down / no key | HTTP **503**, `DATA_SOURCE_UNAVAILABLE` |
| No price drop | HTTP **200**, `NO_PRICE_DROP` |
| Rate limit (30/min/key) | Blocks after max |
| Secret leakage | Response asserts no API key / sensitive fields |

Policy + matching engines are **reused** (no duplicate business path). No SQLite for A2MCP request handling.

## Public HTTPS / external curl

| Item | Status |
|---|---|
| Vercel / Fly CLI | Not available in environment |
| Deploy token | Absent |
| Public HTTPS URL | **Not deployed** |
| External curl over HTTPS | **Not proven** |

**Blocker:** No production host credentials/token for public HTTPS deployment in this environment.

## Local run (when deploying later)

```bash
# Local (not public proof)
npm run dev
curl -s http://127.0.0.1:3000/health
curl -s -X POST http://127.0.0.1:3000/v1/target-price-check \
  -H 'content-type: application/json' \
  -d '{"target_product_url":"https://www.target.com/p/x/-/A-123","purchase_price":10,"currency":"USD","purchase_date":"2026-07-05","country":"US","purchase_channel":"target_online"}'
```

Set `SERPAPI_API_KEY` server-side for live provider data. Never commit the key.

## Closeout rule

Lane 7 full pass requires **external curl over public HTTPS**. Until then: `AFTERBUY_LANE_7_BLOCKED` with local implementation committed.
