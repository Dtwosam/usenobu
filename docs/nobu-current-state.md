# Nobu Current State

**Date:** 2026-07-19
**Status:** LANE 7.2 LOCAL PROOF PASS — UNIQUE PRODUCTION PROOF PENDING; LANE 8 REMAINS NEXT
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


**Lane 7.2 exact identity confirmation split:** **LOCAL PROOF PASS — UNIQUE PRODUCTION PROOF PENDING** - user-provided exact Target URL/TCIN identity is now distinct from third-party SerpApi price observations; valid exact identity can be reviewed and confirmed even when live provider discovery has no strong candidate, while monitoring still requires locked-fingerprint matching against later observations and fails closed on uncertainty. Local unit/typecheck/build/e2e proof passed on commit; unique Vercel production deployment proof has not yet been produced. Evidence: `docs/proof/lane-7-2-exact-identity/`.

**Lane 7.1 product selection + locked fingerprint repair:** **PASS** - candidate confirmation now posts only a candidate id; server reloads the stored discovery snapshot, enforces a 30-minute freshness bound, revalidates the selected offer against the purchase, rejects tampered/stale/weak/title-only/non-Target/Target Plus/wrong-identity selections, and monitoring remains locked-fingerprint-only/fail-closed.
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
| ASP registration | **Done** — agent **#5541** **Nobu** (unchanged) |
| Service | A2MCP, fee **0**, endpoint **https://usenobu.vercel.app/v1/agent** |
| 2026-07-14 submit | Under review, then **rejected** (avatar quality / dimensions) |
| 2026-07-17 fix | **Avatar only** on **#5541** — `newAgentId: null`; polished 440×440 square avatar |
| Resubmit | **`submitApproval.success: true`**, **`approvalStatus: 2`** (under review again) |
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

**Lane 8** is the exact next lane. Do not begin Lane 8 from Lane 7.1 work; wait for explicit Lane 8 execution. Lane 8 remains active until the listing is **approved and publicly accessible**.
Parallel review-safe UI/product proof may continue without ASP resubmit.
Then: **Lane 9 — Demo and submission closeout**.

Evidence: `docs/proof/okx/`, `docs/proof/ui/core-product-proof/`
