# Nobu Current State

**Date:** 2026-07-13  
**Status:** LANE 7.5B1 COMPLETE / DESIGN FOUNDATION

## Locked decisions

- Product name: **Nobu** (prior brand archives only under `docs/proof/historical-afterbuy/`).
- Consumer price-drop protection for Target.com MVP.
- Free A2MCP one-time check first; no x402/wallet work until free listing is stable.
- SerpApi third-party observation only; never official Target API.
- Fail-closed matching; no refund guarantees; Target decides.
- Stateless A2MCP check path (no SQLite as shared production persistence for the endpoint).
- Primary implementation agent: Grok Build.

## Lanes 0–7.5A

Completed. Historical production hostname and curl archives live in `docs/proof/historical-afterbuy/`.

Public A2MCP routes (unchanged):

- `GET /health`
- `POST /v1/target-price-check`

## Lane 7.5B1 proof completed

| Item | Result |
|---|---|
| Design tokens | CSS variables in `app/globals.css` |
| Typography | Manrope 400/500/600/700 via `next/font` |
| Components | `src/ui/*` foundation set |
| Shell | Header, mobile nav, footer, skip link |
| Design spec | `docs/nobu-ui-design-spec.md` |
| Gallery | `/design/foundation` |
| Proof | `docs/proof/ui/foundation/` |
| Product screens | Not fully redesigned (deferred to 7.5B2) |
| API / policy / matching | Unchanged |

## Hard locks (unchanged)

- Target only; Target Plus excluded; U.S. excluding AK/HI unless later verified.
- No retailer login, claim submission, card/banking/ID/wallet secrets.
- No policy/matching/monitoring/SerpApi contract changes in this lane.

## Next active lane

**Lane 7.5B2 — Complete screen implementation.**
