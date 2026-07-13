# Nobu Current State

**Date:** 2026-07-13  
**Status:** LANE 7.5A COMPLETE / GLOBAL NOBU RENAME

## Locked decisions

- Product name: **Nobu** (prior brand archives only under `docs/proof/historical-afterbuy/`).
- Consumer price-drop protection for Target.com MVP.
- Free A2MCP one-time check first; no x402/wallet work until free listing is stable.
- SerpApi third-party observation only; never official Target API.
- Fail-closed matching; no refund guarantees; Target decides.
- Stateless A2MCP check path (no SQLite as shared production persistence for the endpoint).
- Primary implementation agent: Grok Build.

## Lanes 0–7

Completed under prior branding; product behavior preserved. Historical production hostname and curl archives live in `docs/proof/historical-afterbuy/` (see that folder’s README).

Public A2MCP routes (unchanged):

- `GET /health`
- `POST /v1/target-price-check`

## Lane 7.5A proof completed

| Item | Result |
|---|---|
| Active identity | Nobu / `nobu` / `NOBU` |
| Docs pack | `docs/nobu-*.md` |
| OpenAPI | `openapi/nobu-a2mcp.openapi.yaml` (title Nobu A2MCP API) |
| Health service | `nobu-a2mcp` |
| Env example | `NOBU_DB_PATH` |
| Package name | `nobu` |
| Lane verdicts | `NOBU_LANE_*` |
| Active case-insensitive prior-brand scan | Empty (excluding `docs/proof/historical-afterbuy/`) |
| Historical exceptions | Documented in `docs/proof/historical-afterbuy/README.md` |

## Hard locks (unchanged)

- Target only; Target Plus excluded; U.S. excluding AK/HI unless later verified.
- No retailer login, claim submission, card/banking/ID/wallet secrets.
- No policy/matching/monitoring/SerpApi contract changes in this lane.

## Next active lane

**Lane 7.5B — Nobu interface redesign.**
