# Nobu Current State

**Date:** 2026-07-14  
**Status:** LANE 8 BLOCKED — ASP REGISTERED; MARKETPLACE ACTIVATE NEEDS A2A

## Locked decisions

- Product: **AI agent** for post-purchase price monitoring
- Deployment: **UseNobu** at **https://usenobu.vercel.app**
- Live retailer: **Target only**
- Agent API: `POST /v1/agent`
- AI provider (extraction): **Groq**
- Free A2MCP first; no x402

## Production

| Item | Value |
|---|---|
| URL | https://usenobu.vercel.app |
| Agent endpoint | `/v1/agent` |
| Lane 7.5E.2 | **PASS** (live Groq) |
| Lane 8 preflight | **PASS** |

## Lane 8 status

| Gate | Result |
|---|---|
| Production preflight | PASS |
| Wallet login | PASS |
| ASP registration | **Done** — agent **#5541** **Nobu**, A2MCP fee **0**, endpoint **https://usenobu.vercel.app/v1/agent** |
| Marketplace activate / list | **Blocked** — `okx-a2a` not ready (no bound AI provider: codex/claude/hermes/openclaw) |
| Public listing URL | None |
| Verdict | **NOBU_LANE_8_BLOCKED** |

### Human action to finish Gate 4

1. Bind supported AI provider: `okx-a2a ai-provider set --provider <codex|claude|hermes|openclaw>`
2. `okx-a2a doctor --fix` until ready
3. `onchainos agent activate --agent-id 5541 --preferred-language en-US`
4. Resume Lane 8 closeout from activate response

Evidence: `docs/proof/okx/`

## Next active lane

**Lane 8** remains active until marketplace submit succeeds (then PENDING_REVIEW or PASS).  
**Lane 9** not started.
