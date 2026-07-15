# Nobu Current State

**Date:** 2026-07-14  
**Status:** LANE 8 PENDING REVIEW — ASP SUBMITTED TO OKX MARKETPLACE  
**Canonical live match:** **PASS** (`d7bc3de`) — AirTag `PRICE_DROP_DETECTED` $29.99 via unified matcher  
**Live enrollment + check:** **PASS** (`65c69d8`) — production Find my product uses SerpApi; browser `data_source: LIVE` price drop  
**Review-Safe Sprint A:** **NOBU_REVIEW_SAFE_A_PASS** (core monitoring proof UI — safe execution, not end-to-end live price acceptance)  
**Review-Safe Sprint A.1:** **NOBU_REVIEW_SAFE_A_1_PASS** (live SerpApi manual check path — diagnostics / live wiring)  
**Review-Safe Sprint B:** **NOBU_REVIEW_SAFE_B_PASS** (price-drop Action Center)  
**Exact identity + Action Center UX (2026-07-15):** Target URL + TCIN + (model or UPC) required before Find my product; Action Center primary action opens Target Contact Us  
**Review-Safe Sprint C:** **NOBU_REVIEW_SAFE_C_PASS** (judge clarity + money-back story)  
**Review-Safe Sprint A.2:** **NOBU_REVIEW_SAFE_A_2_PASS** (Conair GS14 matching evidence hierarchy repair)  
**Review-Safe Sprint A.3:** **NOBU_REVIEW_SAFE_A_3_PASS** (policy freshness + live Conair closeout; no_match is fail-closed, not accepted price)

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
| Live Target price capability | **BLOCKED** — no currently reproducible accepted observation through canonical `/v1/target-price-check`; see `docs/proof/live-price-reproducibility/` |

## Live price capability notes

- SerpApi new Shopping layout often returns Target **source** + price with **Google-only** links (no TCIN on the offer).
- Safe acceptance requires URL/TCIN/model/UPC hierarchy — not title-only.
- The earlier AirTag acceptance used a temporary capability-audit route with a synthetic locked fingerprint and a monitoring query/matcher. It did not prove canonical A2MCP acceptance.
- Conair GS14: still no safe acceptance when title omits model and immersive recovers a **different** TCIN (fail closed).
- Sprints A–A.3 do **not** claim universal live price acceptance; this capability audit does for ≥1 product.

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
