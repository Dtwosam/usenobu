# Nobu Current State

**Date:** 2026-07-13  
**Status:** LANE 7.5E.2 COMPLETE / LIVE GROQ EXTRACTION

## Locked decisions

- Product: **AI agent** for post-purchase price monitoring
- Deployment: **UseNobu** at **https://usenobu.vercel.app**
- Live retailer: **Target only**
- NL intake: extraction → **user confirmation** → deterministic Find my product
- Agent API: `POST /v1/agent` (bounded actions)
- Structured API: `POST /v1/target-price-check` (unchanged)
- AI provider: **Groq** (`GROQ_API_KEY`, model `openai/gpt-oss-20b`) with deterministic fallback
- Free A2MCP first; no x402
- xAI / `XAI_API_KEY` **not used**

## Production

| Item | Value |
|---|---|
| URL | https://usenobu.vercel.app |
| Agent endpoint | `/v1/agent` |
| Target check | `/v1/target-price-check` |
| Health | `nobu-a2mcp`, `groq_configured: true` |
| Live LLM | **Groq** — `provider: "groq"` proven |
| Proof | `docs/proof/nobu-ai-agent/live-groq-provider/` |
| Verdict | **NOBU_LANE_7_5E_2_PASS** |

## Next active lane

**Lane 8 — OKX ASP registration and live listing**  
Listing endpoint: **`https://usenobu.vercel.app/v1/agent`**
