# AfterBuy Current State

**Date:** 2026-07-13  
**Status:** LANE 3 COMPLETE / SERPAPI LIVE CAPABILITY AUDIT CLOSED

## Locked decisions

- Product: consumer price-drop protection, not a merchant Shopify app.
- Retailer: Target (Target.com / online only).
- Price source: SerpApi Google Shopping (third-party observation, **not** an official Target API).
- Match model: user confirms exact product once; locked fingerprint thereafter (Lane 4+).
- Policy engine: deterministic Target policy (Lane 2 complete).
- Primary implementation agent: Grok Build.
- Ambiguous multi-Target Google Shopping results stay `AMBIGUOUS_TARGET_RESULTS` — never auto-promoted to an exact match.

## Lane 0–2 proof completed

- Source pack, domain schemas, migrations, Target policy engine.

## Lane 3 proof completed

### Connector

- Server-only SerpApi Google Shopping client (`src/serpapi/`).
- Normalization, `shoprs` / filter extraction, merchant vs Google link split, UTF-8 title handling, redaction, search usage recording.
- Fixture unit tests for success, no-Target, ambiguous Target, Target Plus, rate limit, errors, shoprs filter tokens, pass criteria.

### Live capability audit (repair)

| Item | Result |
|---|---|
| Verdict | `AFTERBUY_LANE_3_PASS` |
| New live searches consumed | **2** (max allowed 4) |
| Query 1 | `Apple AirPods Pro MTJV3AM/A` → `NO_TARGET_RESULT` (40 offers, 0 Target) |
| Query 2 | `up&up acetaminophen 500 mg 100 tablets` → **8 Target-sold offers**, status `AMBIGUOUS_TARGET_RESULTS` |
| Pass basis | Target seller + usable prices + identity evidence (title UTF-8 OK, product_id present); **not** treated as exact match |
| Target shoprs tokens | Discovered in filters (`target_shoprs_discovered: true`); not required for pass |
| Merchant direct Target.com links | **Not returned** on live layout (Google product links only) |
| Secrets | Redacted fixtures/reports; no API key in proof files |
| Evidence | `docs/proof/serpapi/repair-audit-summary.json` and redacted repair fixtures |

### Prior failed broad query (historical)

- `Apple AirPods Pro 2 USB-C Target` → 40 offers, 0 Target (marketplace-dominated).

### Explicit non-scope

- No product matching engine, no user confirmation flow, no scheduler/UI/deploy/OKX (Lane 4+).

## Remaining later gates

1. Candidate matching and product confirmation (Lane 4).
2. Monitoring loop, consumer UI, free A2MCP endpoint, OKX listing, demo/submission.

## Risk register snapshot

- Google Shopping may omit Target or return only Google product links (no merchant deep link).
- Multiple Target-sold rows require fail-closed matching (Lane 4) — status remains ambiguous until user confirmation.
- Free-plan SerpApi capacity is limited; budget searches carefully.
- Target makes the final price-adjustment decision.

## Next active lane

**Lane 4 — Candidate matching and product confirmation.**
