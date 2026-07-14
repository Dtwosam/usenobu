# Live Product Enrollment Proof

**Date:** 2026-07-14  
**Verdict:** `NOBU_LIVE_ENROLLMENT_AND_CHECK_PASS`

## Phase 3 — Proven enrollment cause

**`PRODUCTION_DISCOVERY_ALWAYS_FIXTURE`**

| Item | Finding |
|---|---|
| Route | `app/purchases/[id]/review/page.tsx` called `buildFixtureOffers` on every render |
| Action | `createPurchaseFlow` always built fixture offers |
| Environment gate | None on discovery (manual-check had a gate; enrollment did not) |
| Candidate source | Demo fixtures labelled `DEMO FIXTURE DATA` |
| Live service elsewhere | SerpApi client + `buildMonitorShoppingQuery` existed for monitoring / A2MCP only |

## Fixture boundary (after repair)

| Mode | Discovery |
|---|---|
| Production (default) | **LIVE** SerpApi only |
| `VITEST` / `NODE_ENV=test` | FIXTURE allowed |
| `NOBU_FIXTURE_MODE=1` | FIXTURE allowed |
| `NOBU_FORCE_LIVE_CHECKS=1` | LIVE always |

Provider failure shows: *Nobu could not find a reliable Target product right now.*  
No silent fixture fallback.

## Implementation

- `src/web/live-discovery.ts` — live SerpApi discovery + enrollment matcher
- `src/web/discovery-store.ts` — persist discovery for review/confirm
- `createPurchaseFlow` async — LIVE vs gated FIXTURE
- Review page loads stored discovery (no `buildFixtureOffers` in production path)
- Cookie snapshot includes `enrollment_discovery`

## Browser proof (`https://usenobu.vercel.app`)

| Step | Result |
|---|---|
| Find my product | `source=LIVE`, `discovery_data_source=LIVE` |
| Fixture banner | **absent** |
| Match | `EXACT_MATCH_CANDIDATE` — Apple AirTag |
| Confirm | Locked fingerprint from live candidate |
| Check price now | `outcome=price_drop`, `data_source=LIVE` |
| Alert | `/alerts/alert_…` |
| Refresh | Alert/price preserved; no fixture label |

Files: `browser-proof.json`, screenshots `01`–`04`.

## Provider calls (this closeout)

1. Canonical AirTag (Phase 1) — already counted under v2 proof  
2. Browser Find my product — 1 live discovery  
3. Browser Check price now — 1 live monitor search  
4. Negative accessory — covered by unit tests (no extra live call)

## Hard locks preserved

Agent `5541`, `POST /v1/agent` frozen, fail-closed matching, no hardcoded AirTag price/TCIN, Google product id ≠ TCIN.
