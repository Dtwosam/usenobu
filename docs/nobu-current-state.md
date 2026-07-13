# Nobu Current State

**Date:** 2026-07-13  
**Status:** LANE 7.5B2 COMPLETE / CONSUMER SCREENS

## Locked decisions

- Product name: **Nobu** (prior brand archives only under `docs/proof/historical-afterbuy/`).
- Consumer price-drop protection for Target.com MVP.
- Free A2MCP one-time check first; no x402/wallet work until free listing is stable.
- SerpApi third-party observation only; never official Target API.
- Fail-closed matching; no refund guarantees; Target decides.
- Stateless A2MCP check path (no SQLite as shared production persistence for the endpoint).
- Primary implementation agent: Grok Build.

## Lanes 0–7.5B1

Completed. Design system tokens/components in `src/ui/` and `app/globals.css`.

Public A2MCP routes (unchanged):

- `GET /health`
- `POST /v1/target-price-check`

## Lane 7.5B2 proof completed

| Item | Result |
|---|---|
| Consumer screens | Homepage, add purchase, review, purchase dashboard, price-drop, notices, list dashboard |
| Design system reuse | B1 components + tokens only |
| Status copy | Plain English (`Watching the price`, etc.) |
| Fixture banner | “Demo data” on data-bearing screens |
| Screenshots | `docs/proof/ui/screens/` |
| Domain / API / matching | Unchanged |

## Hard locks (unchanged)

- Target only; Target Plus excluded; U.S. excluding AK/HI unless later verified.
- No retailer login, claim submission, card/banking/ID/wallet secrets.
- No policy/matching/monitoring/SerpApi/A2MCP contract changes in this lane.

## Next active lane

**Lane 7.5B3 — Visual QA, polish and deployment.**
