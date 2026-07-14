# Review-Safe Sprint A — Core Product Proof

**Date:** 2026-07-14  
**Verdict:** `NOBU_REVIEW_SAFE_A_PASS`  
**Production:** https://usenobu.vercel.app  
**Lane 8:** remains `NOBU_LANE_8_PENDING_REVIEW` (ASP #5541) — not completed by this sprint.

## Goal

Make Nobu visibly prove real post-purchase monitoring without crowding the UI:

1. Bounded **Check price now**
2. Compact **Monitoring Proof** panel
3. Short truthful decision explanations

## Implementation (exact)

| Area | Path |
|---|---|
| Outcome copy | `src/web/check-outcome.ts` |
| Bounded check + guards | `src/web/manual-check.ts` |
| Server action | `src/web/actions.ts` → `runBoundedManualCheck` |
| Dashboard UI | `app/purchases/[id]/page.tsx` |
| Loading button | `app/purchases/[id]/CheckPriceButton.tsx` |
| Session (Vercel cookie) | `src/web/session-snapshot.ts`, `src/web/prepare-db.ts` |

### Reused production path (no second matcher)

`runBoundedManualCheck` → `runDemoPriceCheck` → `runMonitoringPass` with locked fingerprint, Target seller validation, deterministic matching, policy engine, observation persistence, and idempotent alert creation.

Demo path uses **fixture offers** (`data_source: FIXTURE`), not a live SerpApi shopping call. Budget ledger still records searches.

### Protections

- Purchase owner (`user_ref === demo-user`)
- Confirmed locked fingerprint + `MONITORING_ACTIVE`
- 30s per-purchase cooldown
- Concurrent in-process lock
- Monthly search-budget guard (runner)
- Button hidden when preconditions fail; loading: **Checking the confirmed product…**
- Provider failure never creates a positive result
- Unchanged / repeated lower price does not create a duplicate alert (idempotent `alert_key`)

### Default visible UI

- Monitoring status, purchase price, latest accepted price, last checked, days remaining
- One support sentence: *Nobu is watching the exact product you confirmed.*
- One primary action: **Check price now**
- Quiet **View details** for timestamps, counts, provider/match/policy/alert evidence
- Never invents next scheduled check

### Decision explanations (short)

Examples: *No lower price found.* · *Possible price difference found.* · *Nobu could not confirm the exact product.* · seller/ambiguous rejections in plain English. Full provenance behind **View details**.

## Tests

| Suite | Result |
|---|---|
| `npm test` | **185 passed** |
| Targeted monitoring + web checks | pass (`tests/monitoring`, `tests/web/*`) |
| `npm run typecheck` | pass |
| `npm run build` | pass |
| `npm run test:e2e` | **28 passed**, 2 skipped (prod-only) |
| Secret scan | **PASS** (`secret-scan.json`) |
| Accessibility (axe) | no critical/serious on monitoring proof |
| Production proof | `prod-proof.json` → **NOBU_REVIEW_SAFE_A_PASS** |

### Fixture labels

All consumer demo checks are **FIXTURE** / demo-banner labelled.  
`real_provider_calls_consumed: 0` for the bounded dashboard check path.

## Production smoke

| Check | Result |
|---|---|
| `GET /health` | 200 ok |
| `POST /v1/agent` | frozen actions only; unknown purchase → 404 not_found |
| Confirm → Check price now | alert page with summary |
| Second check | `outcome=no_lower` (no duplicate positive drop) |
| Mobile 320 / 390 | no horizontal overflow |
| Screenshots | `desktop-monitoring-proof.png`, `desktop-price-drop.png`, `mobile-*.png` |

## Session fix (supporting)

Vercel cookie snapshot re-hydrates every request (clear + import), keeps FK-safe match rows, stubs `provenance_json`, and trims under cookie size limits so confirm/check/alert survive multi-instance.

## Hard locks (unchanged)

- `POST /v1/agent` schema/actions frozen  
- Agent ID **5541** / ASP not resubmitted  
- Target-only, SerpApi provenance, matching/policy rules, fingerprint contract  
- No email, x402, OCR, demo route, second retailer  

## Lane 8

**NOBU_LANE_8_PENDING_REVIEW** — still under marketplace review. Do not mark complete.

## Sprint A.1 follow-up

**Live manual check repair** — production Check price now uses SerpApi (not fixtures).  
Evidence: `docs/proof/ui/core-product-proof/live-manual-check/` — `NOBU_REVIEW_SAFE_A_1_PASS`.

## Sprint B

**Action Center** — safe next steps for accepted price differences.  
Evidence: `docs/proof/ui/action-center/` — `NOBU_REVIEW_SAFE_B_PASS`.

## Next sprint

Continue Lane 8 monitoring until public approval → Lane 9 closeout.
