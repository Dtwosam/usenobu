# Nobu Current State

**Date:** 2026-07-13  
**Status:** LANE 7.5E COMPLETE / BOUNDED AI AGENT INTAKE

## Locked decisions

- Product: **AI agent** for post-purchase price monitoring
- Deployment: **UseNobu** at **https://usenobu.vercel.app**
- Live retailer: **Target only**
- NL intake: extraction → **user confirmation** → deterministic Find my product
- Agent API: `POST /v1/agent` (bounded actions)
- Structured API: `POST /v1/target-price-check` (unchanged)
- AI provider: xAI (`XAI_API_KEY`) with deterministic fallback extractor
- Free A2MCP first; no x402

## Production

| Item | Value |
|---|---|
| URL | https://usenobu.vercel.app |
| Agent endpoint | `/v1/agent` |
| Target check | `/v1/target-price-check` |
| Health | `nobu-a2mcp` |

## Lane 7.5E proof

| Item | Result |
|---|---|
| UNDERSTAND_PURCHASE → CONFIRMATION_REQUIRED | Yes |
| No auto matching/monitoring from AI | Yes |
| Manual entry + Find my product | Yes |
| Deterministic tests | Green (155 unit) |
| Existing matching/policy/A2MCP tests | Green |
| E2E | 24 passed / 2 skipped |
| Production browser NL flow | `docs/proof/nobu-ai-agent/` |
| Production `/v1/agent` API | PROD_PROOF_PASS |
| Verdict | **NOBU_LANE_7_5E_PASS** |

## Next active lane

**Lane 8 — OKX ASP registration and live listing**  
Listing endpoint: **`https://usenobu.vercel.app/v1/agent`**
