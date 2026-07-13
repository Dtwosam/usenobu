# AfterBuy Current State

**Date:** 2026-07-13  
**Status:** LANE 3 BLOCKED — OFFLINE CONNECTOR COMPLETE / LIVE AUDIT PENDING KEY

## Locked decisions

- Product: consumer price-drop protection, not a merchant Shopify app.
- Retailer: Target.
- Channel: Target.com / Target online purchases only.
- Price source: SerpApi Google Shopping API.
- SerpApi classification: provisional third-party observation source (not an official Target API).
- Match model: user confirms exact product once; later checks use a locked fingerprint.
- Policy window: up to 14 days after purchase, subject to Target's current policy and exclusions.
- ASP: free A2MCP first.
- Primary category: Lifestyle Companion.
- Primary repository implementation agent: Grok Build (lane by lane).
- Domain contracts + Target policy engine complete (Lanes 1–2).
- SerpApi connector: server-only client with normalization, redaction, usage recording, and fixture tests.

## Lane 0–2 proof completed

- Source pack, baseline, domain schemas, migrations, deterministic Target policy engine.

## Lane 3 offline proof completed

- Server-only SerpApi Google Shopping client (`src/serpapi/`).
- Normalized shopping offers and locked provider statuses.
- Timeout, rate-limit, and provider-error handling.
- API-key redaction from logs/errors/serialized results.
- Connector unit tests with fixtures (no network).
- Search usage counter recorded on live and optional fixture paths.
- Offline capability notes: `docs/proof/serpapi/offline-capability-report.md`.
- No optimistic product matching, scheduler, UI, alerts, or Target scraping.

## Lane 3 live proof blocked

| Blocker | Detail |
|---|---|
| `SERPAPI_API_KEY` | Not set in environment; no `.env` present |
| Live query | Not executed (0 live searches consumed) |
| Redacted live fixture | Not produced |
| Live field audit | Not produced |

**Exact live-proof blocker:** `SERPAPI_API_KEY is not set`.

To complete Lane 3: set a server-side `SERPAPI_API_KEY`, run `npm run serpapi:live-audit`, verify redacted fixture under `docs/proof/serpapi/`, then close the lane and advance to Lane 4.

## Remaining later gates

1. Provide SerpApi key and complete live capability audit (Lane 3 closeout).
2. Prove exact product matching and fail-closed behavior (Lane 4).
3. Deploy free A2MCP endpoint and OKX listing.
4. Demo, X post, and official submission before the deadline.

## Risk register snapshot

- Google Shopping may omit Target, return stale data, or mix sellers.
- Free-plan search capacity is limited; usage must be budgeted.
- Target must independently verify the lower price.
- Hackathon approval timing can consume the remaining deadline window.

## Next active lane

**Lane 3 (continue) — complete live SerpApi capability audit when `SERPAPI_API_KEY` is available.**  
After live proof: **Lane 4 — Candidate matching and product confirmation.**
