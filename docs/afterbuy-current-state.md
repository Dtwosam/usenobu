# AfterBuy Current State

**Date:** 2026-07-13  
**Status:** LANE 5 COMPLETE / IDEMPOTENT PRICE MONITORING LOOP

## Locked decisions

- Product: consumer price-drop protection, not a merchant Shopify app.
- Retailer: Target only; Target Plus excluded.
- Price source: SerpApi Google Shopping (third-party observation, **not** an official Target API).
- SerpApi `product_id` is never TCIN.
- Match: fail-closed Target-only; user confirms once; locked fingerprint for all later checks.
- Monitoring: only `MONITORING_ACTIVE` purchases with locked fingerprints; budget never overspent silently.
- Alerts: one idempotent price-drop alert per purchase/fingerprint/observed price; no refund guarantees.
- Primary implementation agent: Grok Build.

## Lanes 0–4 proof completed

- Source pack, domain schemas, Target policy engine, SerpApi connector + live audit, fail-closed matching and confirmation.

## Lane 5 proof completed

### Monitoring loop (`src/monitoring/`)

| Capability | Status |
|---|---|
| Active-window selection (14-day / deadline) | Done |
| Deterministic monthly search-budget guard | Done (default 250) |
| Manual + scheduled check runner | Done |
| Locked-fingerprint validation every observation | Done |
| Price observation + monitor_run persistence | Done |
| Lower-price detection + potential recovery | Done |
| Expiry handling (`WINDOW_EXPIRED`, no search) | Done |
| Idempotent alert creation (`alert_key`) | Done |

### Migration

- `0003_monitoring`: `search_budget_ledger`, `monitor_runs`, `alerts`.

### Tests (fixture / simulated — no live SerpApi)

- Valid price drop → exactly one alert; replay → no duplicate.
- Expired purchase → not searched; status `WINDOW_EXPIRED`.
- Budget exhausted → skipped with recorded reason; 0 searches.
- Mismatch → no alert; ambiguous multi-match → no alert.
- Full suite + typecheck pass.

### Explicit non-scope

- No consumer UI, no public deploy, no A2MCP/OKX (Lane 6+).

## Remaining later gates

1. Consumer web flow (Lane 6).
2. Free A2MCP endpoint, OKX listing, demo/submission.

## Risk register snapshot

- SerpApi capacity limited; scheduler must keep budgeting.
- Google Shopping may return ambiguous Target rows → fail closed, no alert.
- Merchant deep links may be missing; fingerprint identity still required.
- Target makes the final adjustment decision.

## Next active lane

**Lane 6 — Consumer web flow.**
