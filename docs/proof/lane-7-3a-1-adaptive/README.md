# Lane 7.3A.1 — Adaptive product discovery

**Verdict:** `NOBU_LANE_7_3A_1_PASS`

**Commit:** `b2d99b2d8036dcc813bb4d861a31484663c60fbe`

## Corrected user journey

1. Open `/purchases/new` — one product-details section (no mode choice).
2. Enter price, date, and any product clue (title, URL, TCIN, model, UPC…).
3. Find my product is disabled until a usable clue exists.
4. Nobu adaptively returns one strong candidate, 3–5 multi-candidates, or no-results.
5. User selects (when multi) and always explicitly confirms before monitoring.

## Removed interface

- How do you want to identify the product?
- Exact product / Help me find the product
- Mode-specific duplicated fields

## Local proof

- `npm test` — 323 passed, 1 skipped
- typecheck / build — pass
- Playwright adaptive-discovery — 3 passed
- Playwright consumer-flow (full prior run + URL-only fix) — pass

## Deployment

| Item | Value |
|---|---|
| Unique preview | https://usenobu-i4dsbjtbw-dtwoflicks-2878s-projects.vercel.app |
| Unique production | https://usenobu-63qlryu08-dtwoflicks-2878s-projects.vercel.app |
| Canonical | https://usenobu.vercel.app |
| afterbuy.vercel.app | removed (404) |

Canonical: health 200 ok; purchases/new has product-details, no mode selector.

## ASP #5541

- Unchanged read-only: endpoint `https://usenobu.vercel.app/v1/agent`, fee 0, approvalStatus 2

## Next

Lane 8 reviewer-status monitoring. Lane 7.3B email notifications remains queued.
