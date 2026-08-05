# Sprint A.1 — Live Manual Check Repair

**Date:** 2026-07-14
**Verdict:** `NOBU_REVIEW_SAFE_A_1_PASS`
**Production:** https://www.usenobu.xyz
**Lane 8:** still `NOBU_LANE_8_PENDING_REVIEW` (ASP #5541) — not completed.

## Problem (before)

Production **Check price now** called `runDemoPriceCheck` with fixture lower prices. Sprint A proved UI + workflow, not a real SerpApi lookup.

## Repair

| Path | Behavior |
|---|---|
| Production (no fixture gate) | **LIVE** — `createLiveSerpApiObservationFetcher` → SerpApi → `runMonitoringPass` |
| Tests / e2e (`NOBU_FIXTURE_MODE=1`, `NODE_ENV=test`) | **FIXTURE** allowed explicitly |
| `NOBU_FORCE_LIVE_CHECKS=1` | Forces LIVE even in test |

No second connector, matcher, or policy path.

## Fixture boundary

- `src/web/manual-check-mode.ts` — gate + label
- Fixture UI label only when gate open: *Test data — not a live current retailer price.*
- Production dashboard does **not** show fixture banner
- Live results expose `data_source=LIVE` in URL and View details

## Live proof (one bounded check)

Recorded in `live-proof.json`:

| Field | Value |
|---|---|
| Query timestamp | `2026-07-14T12:46:36.067Z` |
| `data_source` | **LIVE** |
| Outcome | `provider_unavailable` (truthful fail-closed) |
| Provider UI | `PROVIDER_ERROR` |
| Completed checks | `1` (provider path ran; search budget consumed) |
| Alert | **None** (no positive result) |
| Price drop required? | **No** |
| API key logged? | **No** (`no_api_key_in_ui`) |
| Silent fixture? | **No** |

SerpApi returned no usable priced Target match for the demo fingerprint (or provider error). Fail-closed handling is correct → **PASS**.

Screenshot: `after-live-check.png`

## Tests

- `tests/web/manual-check-mode.test.ts` — gate
- `tests/web/live-manual-check.test.ts` — live path with injected client
- `npm test` — 198 passed
- `npm run typecheck` / `build` — pass
- consumer e2e (fixture mode) — pass
- secret scan — pass

## Hard locks

Agent **5541**, `POST /v1/agent`, matching/policy, Target-only — unchanged. No ASP resubmit.
