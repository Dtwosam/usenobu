# Lane 7.3A.1 — Adaptive product discovery

**Verdict:** NOBU_LANE_7_3A_1_PASS (local proof; deployment proof appended after promote)

## Corrected user journey

1. User opens `/purchases/new` — one product-details section (no mode choice).
2. Supplies price, date, and any product clue (title, URL, TCIN, model, UPC…).
3. Find my product is disabled until a usable clue exists.
4. Nobu adaptively returns one strong candidate, 3–5 multi-candidates, or no-results.
5. User selects (when multi) and always explicitly confirms before monitoring.

## Removed interface

- How do you want to identify the product?
- Exact product / Help me find the product radios
- Mode-specific duplicated fields

## Visual proof screens

See `screens/` from Playwright adaptive-discovery.spec.ts.
