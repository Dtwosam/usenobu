# Lane 7.3A — Purchase intake UX + multi-candidate discovery

**Verdict:** `NOBU_LANE_7_3A_PASS`

**Commit:** `f94d27517180d054b3b7638c5c560d86f8597f01`
**GitHub HEAD:** matches local `origin/master`

## Implemented UX

- Exact product mode: Target URL **or** TCIN (not both required)
- Help me find the product: description + price + date → multi-candidate Target list
- Fill with AI: valid TCIN alone is enough; never demands URL when TCIN present
- Link-derived provisional titles; provider enrichment may improve; failure keeps fallback
- Demo options removed from production `/purchases/new`

## Root causes

1. `evaluateExactIdentity` required URL+TCIN together
2. `computeMissingFields` always required `product_url`
3. Form UI forced required URL and showed Demo options
4. Discovery store / cookie snapshot kept only 1–2 candidates

## Local proof

- `npm test` — 317 passed, 1 skipped
- `npm run typecheck` — pass
- `npm run build` — pass
- Playwright `tests/e2e/consumer-flow.spec.ts` — 10 passed
- Fixture multi-candidate: Target-only, Target Plus excluded, duplicates collapsed, 3–6 bound, no auto-confirm
- Session snapshot preserves `offer_id` for multi-candidate confirm across instances

## Deployment

| Item | Value |
|---|---|
| Unique preview | https://usenobu-jd32is8xq-dtwoflicks-2878s-projects.vercel.app |
| Unique production | https://usenobu-iu55e3xth-dtwoflicks-2878s-projects.vercel.app |
| Canonical | https://usenobu.vercel.app |
| afterbuy.vercel.app | removed again (404) — accidental auto-alias on `--prod` was cleaned |

### Canonical production checks

- GET `/health` → 200, `status: ok`, SerpApi + Groq configured
- GET `/purchases/new` → 200; Demo options absent; mode controls present in JS bundle; no afterbuy brand
- Unique production `/health` → 200

## ASP #5541 (read-only)

- Name: Nobu
- approvalStatus: 2 (Listing under review)
- Endpoint: `https://usenobu.vercel.app/v1/agent`
- Fee: 0 USDT
- **No edit, resubmit, or new ASP performed**

## Next lane

Lane 7.3B — consented email price-drop notifications.
