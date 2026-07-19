# Lane 7.3A — Purchase intake UX + multi-candidate discovery

**Verdict:** NOBU_LANE_7_3A_PASS (local proof complete; deployment proof appended after promote)

## Implemented UX

- Exact product mode: Target URL **or** TCIN (not both required)
- Help me find the product: description + price + date → multi-candidate Target list
- Fill with AI: valid TCIN alone is enough; never demands URL when TCIN present
- Link-derived provisional titles; provider enrichment may improve; failure keeps fallback
- Demo options removed from production `/purchases/new`

## Local proof

- `npm test` — 317 passed, 1 skipped
- `npm run typecheck` — pass
- `npm run build` — pass
- Playwright `tests/e2e/consumer-flow.spec.ts` — 10 passed
- Fixture multi-candidate: Target-only, Target Plus excluded, duplicates collapsed, 3–6 bound, no auto-confirm
- Session snapshot preserves `offer_id` for multi-candidate confirm across instances

## Root causes fixed

1. `evaluateExactIdentity` required URL+TCIN
2. `computeMissingFields` always required `product_url`
3. Form UI forced required URL and Demo options control
4. Discovery store / cookie snapshot kept only 1–2 candidates and risked dropping multi-select identity
