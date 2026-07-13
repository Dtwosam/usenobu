# Lane 7 external HTTPS closeout

**Public base URL:** `https://afterbuy.vercel.app`  
**Proved at:** 2026-07-13T16:45:05Z  
**Protocol:** HTTPS only  

Redacted evidence files: `docs/proof/a2mcp/curl-*-2026-07-13T16-44-24Z.json`, `external-curl-summary-latest.json`.

## Curl outcomes

| Proof | HTTP | Body status / error | Secret leak |
|---|---|---|---|
| `GET /health` | **200** | `status: ok`, service `afterbuy-a2mcp` | No |
| Valid OpenAPI `POST /v1/target-price-check` | **503** | `DATA_SOURCE_UNAVAILABLE` (structured OpenAPI fields present) | No |
| Invalid input (`currency: EUR`) | **400** | `error: invalid_input` | No |
| Fail-closed AK region | **200** | `UNSUPPORTED_PURCHASE` | No |
| Ambiguous / weak match path (`UPUP-ACET-500`) | **200** | `MATCH_REVIEW_REQUIRED` | No |
| Rate limiting | **429** | after 27 requests (in-process limit 30/min; prior calls counted) | No |

### Notes

1. **Valid schema request** was accepted and returned **documented** OpenAPI JSON. Host returned `503 DATA_SOURCE_UNAVAILABLE` because live SerpApi was not available to that deployment at proof time (no silent fake prices). Required response fields still present: `status`, `policy_id`, `price_source_type`, `final_decision_by`, `checked_at`, disclaimer.
2. **Fail-closed:** Alaska → `UNSUPPORTED_PURCHASE`; multi-candidate product path → `MATCH_REVIEW_REQUIRED` (no positive eligibility).
3. **No secrets** in any archived response body (scanned).
4. In-process unit tests still prove **200 + PRICE_DROP_DETECTED** when offers are injected (`tests/a2mcp/a2mcp.test.ts`).

## Local verification also run

- `npm test` — pass  
- `npm run typecheck` — pass  
- `npm run build` — pass (`/health`, `/v1/target-price-check` routes present)
