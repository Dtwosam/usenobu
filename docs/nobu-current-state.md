# Nobu Current State

**Date:** 2026-07-14  
**Status:** LANE 8 PENDING REVIEW — ASP SUBMITTED TO OKX MARKETPLACE

## Locked decisions

- Product: **AI agent** for post-purchase price monitoring
- Deployment: **UseNobu** at **https://usenobu.vercel.app**
- Live retailer: **Target only**
- Agent API: `POST /v1/agent`
- AI extraction: **Groq**
- Free A2MCP first; no x402

## Production

| Item | Value |
|---|---|
| URL | https://usenobu.vercel.app |
| Agent endpoint | `/v1/agent` |
| Lane 7.5E.2 | **PASS** (live Groq) |
| Lane 8 preflight | **PASS** |

## Lane 8 status

| Item | Result |
|---|---|
| ASP registration | **Done** — agent **#5541** **Nobu** |
| Service | A2MCP, fee **0**, endpoint **https://usenobu.vercel.app/v1/agent** |
| Marketplace submit | **`submitApproval.success: true`**, **`approvalStatus: 2`** |
| `activate.success` | `false` (not live yet; under review) |
| `rejectReason` | `null` |
| Public listing URL | **None** — not claimed live |
| Verdict | **NOBU_LANE_8_PENDING_REVIEW** |

### Do not

- Create another ASP
- Repeatedly resubmit activation while under review
- Claim public live listing or Lane 9 closeout yet

### Monitor

- Agentic Wallet email
- Real ASP / approval status

## Next active lane

**Lane 8** remains active until the listing is **approved and publicly accessible**.  
Then: **Lane 9 — Demo and submission closeout**.

Evidence: `docs/proof/okx/`
