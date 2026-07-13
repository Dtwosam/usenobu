# Nobu Current State

**Date:** 2026-07-14  
**Status:** LANE 8 BLOCKED — AWAITING AGENTIC WALLET LOGIN

## Locked decisions

- Product: **AI agent** for post-purchase price monitoring
- Deployment: **UseNobu** at **https://usenobu.vercel.app**
- Live retailer: **Target only**
- NL intake: extraction → **user confirmation** → deterministic Find my product
- Agent API: `POST /v1/agent` (bounded actions)
- Structured API: `POST /v1/target-price-check` (unchanged)
- AI provider: **Groq** (`GROQ_API_KEY`, model `openai/gpt-oss-20b`) with deterministic fallback
- Free A2MCP first; no x402

## Production

| Item | Value |
|---|---|
| URL | https://usenobu.vercel.app |
| Agent endpoint | `/v1/agent` |
| Target check | `/v1/target-price-check` |
| Health | `nobu-a2mcp`, `groq_configured: true`, `serpapi_configured: true` |
| Lane 7.5E.2 | **PASS** (live Groq) |
| Lane 8 preflight | **PASS** — `docs/proof/okx/preflight.json` |

## Lane 8 status

| Gate | Result |
|---|---|
| Production preflight | PASS |
| Onchain OS skills + CLI 4.2.4 | Installed |
| Agentic Wallet login | **`loggedIn: false`** — **blocker** |
| ASP registration | Not started |
| Marketplace listing | Not started |
| Public listing URL | None (not registered) |
| Verdict | **NOBU_LANE_8_BLOCKED** |

### Exact human action required

An eligible adult or guardian must authenticate Onchain OS Agentic Wallet (email OTP or Developer Portal API-key flow). Complete any platform age, terms, or identity steps personally. Do not share OTP codes, session tokens, or keys with the agent. Then resume Lane 8 Gates 3–4.

## Next active lane

**Lane 8 — OKX ASP registration and live listing** (still active; blocked on wallet login)  
Listing endpoint when registered: **`https://usenobu.vercel.app/v1/agent`**

Lane 9 is not started.
