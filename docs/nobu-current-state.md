# Nobu Current State

**Date:** 2026-07-14  
**Status:** LANE 8 PENDING REVIEW — ASP SUBMITTED TO OKX MARKETPLACE  
**Review-Safe Sprint A:** **NOBU_REVIEW_SAFE_A_PASS** (core monitoring proof UI)  
**Review-Safe Sprint A.1:** **NOBU_REVIEW_SAFE_A_1_PASS** (live SerpApi manual check)  
**Review-Safe Sprint B:** **NOBU_REVIEW_SAFE_B_PASS** (price-drop Action Center)  
**Review-Safe Sprint C:** **NOBU_REVIEW_SAFE_C_PASS** (judge clarity + money-back story)  
**Review-Safe Sprint A.2:** **NOBU_REVIEW_SAFE_A_2_PASS** (Conair GS14 live matching evidence repair)  
**Review-Safe Sprint A.3:** **NOBU_REVIEW_SAFE_A_3_PASS** (policy freshness refresh + live Conair closeout)

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
| Sprint A core proof | **PASS** — bounded Check price now + Monitoring Proof panel |
| Sprint A.1 live check | **PASS** — production manual check uses SerpApi (not silent fixtures) |
| Sprint B Action Center | **PASS** — Open on Target / Contact / Copy for accepted price drops |
| Sprint C judge clarity | **PASS** — retailer-neutral hero + money-back benefit; validation kit ready |
| Sprint A.2 live matching | **PASS** — monitoring uses URL/TCIN/model hierarchy; Conair GS14 evidence path fixed |
| Sprint A.3 policy + live closeout | **PASS** — policy verified 2026-07-14; Conair LIVE check not POLICY_STALE |

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
- Mark Lane 8 complete from Sprint A alone

### Monitor

- Agentic Wallet email
- Real ASP / approval status

## Next active lane

**Lane 8** remains active until the listing is **approved and publicly accessible**.  
Parallel review-safe UI/product proof may continue without ASP resubmit.  
Then: **Lane 9 — Demo and submission closeout**.

Evidence: `docs/proof/okx/`, `docs/proof/ui/core-product-proof/`
