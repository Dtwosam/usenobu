# Nobu Current State

**Date:** 2026-07-20
**Status:** LANE 7.3B PASS — CONSENTED PRICE-DROP EMAIL ALERTS; NEXT LANE 8 (QUEUED)
**Canonical live match:** **PASS** (`d7bc3de`) — AirTag `PRICE_DROP_DETECTED` $29.99 via unified matcher
**Live enrollment + check:** **PASS** (`65c69d8`) — production Find my product uses SerpApi; browser `data_source: LIVE` price drop
**Review-Safe Sprint A:** **NOBU_REVIEW_SAFE_A_PASS** (core monitoring proof UI — safe execution, not end-to-end live price acceptance)
**Review-Safe Sprint A.1:** **NOBU_REVIEW_SAFE_A_1_PASS** (live SerpApi manual check path — diagnostics / live wiring)
**Review-Safe Sprint B:** **NOBU_REVIEW_SAFE_B_PASS** (price-drop Action Center)
**Exact identity + Action Center UX (2026-07-15):** Target URL + TCIN + (model or UPC) required before Find my product; Action Center primary action opens Target Contact Us
**Review-Safe Sprint C:** **NOBU_REVIEW_SAFE_C_PASS** (judge clarity + money-back story)
**Review-Safe Sprint A.2:** **NOBU_REVIEW_SAFE_A_2_PASS** (Conair GS14 matching evidence hierarchy repair)
**Review-Safe Sprint A.3:** **NOBU_REVIEW_SAFE_A_3_PASS** (policy freshness + live Conair closeout; no_match is fail-closed, not accepted price)

**Lane 7.3A.2A account-private My Purchases:** **PASS** (`NOBU_LANE_7_3A_2A_PASS`) — every new purchase has one server-assigned owner (`usr_*` httpOnly cookie, minted by middleware / server actions; client owner/user/email fields ignored). Consumer list/read/confirm/check/alert are owner-scoped; cross-user and missing IDs both yield generic **Purchase not found**. Ownerless and legacy shared `demo-user` rows are quarantined (not reassigned, not listed). Production My Purchases never shows the **Demo data** fixture banner; fixtures stay gated to tests/e2e (`NOBU_FIXTURE_MODE`). Scheduler/internal monitoring remains a separate protected boundary and may process across owners. Privacy reassurance copy under My Purchases. Evidence: unit privacy + fixture isolation tests; Playwright two-user privacy; full unit suite; typecheck; build.

**Lane 7.3A.2A.1 passwordless accounts + guest claim:** Guests keep `nobu_owner_v1` (`usr_*`) browser-scoped ownership (not called an account). Verified passwordless email magic-link creates stable `acct_*` account IDs and httpOnly auth session; on verify, eligible guest purchases are claimed atomically onto the account (idempotent; never ownerless/demo-user/other accounts). Logout revokes session and does not delete history or move purchases back to guest. UI: `/sign-in`, guest notice, claim success, account menu.

**Lane 7.3A.2A.1R magic-link + durable auth repair:** Root causes of laptop/phone failures: (1) GET `/auth/verify` consumed one-time tokens (email previews invalidated links in seconds); (2) auth tokens/sessions lived in per-instance SQLite + browser cookie snapshot, so phone/server instances could not see laptop-issued tokens. Repair: durable Postgres AuthStore (`DATABASE_URL` / `POLICY_OPS_DATABASE_URL`) for accounts, tokens, sessions, claims, and account purchase blobs; auth **not** in cookie snapshot; cookies hold only opaque session/guest tokens. Safe verify: GET peeks only → confirmation UI → POST consumes once. Magic-link origin defaults to `https://www.usenobu.xyz` (A2MCP remains `https://usenobu.vercel.app/v1/agent`).

**Lane 7.3A.2B persistent purchase history + lifecycle:** Signed-in purchases remain in durable account blobs after monitoring ends. My Purchases tabs: **Active** / **History** / **Archived** via centralized lifecycle mapper (status + deadline + archive flag). Archive is visibility-only; restore returns to the correct tab. User-reported Target outcomes (not contacted / requested / approved / declined / did not request) store with timestamp and disclosure *Reported by you — not verified by Target* without changing matching, policy, or prices. Owner-authorized archive, restore, delete (confirm required). Guests keep browser-scoped lists; cross-device history requires sign-in.

**Lane 7.3B consented automatic price-drop email alerts:** **PASS** (`NOBU_LANE_7_3B_PASS`) — purchase-level **Email me about possible price drops** consent (off by default, durable timestamp, disable anytime). Emails only to verified account email (masked UI; no second address field). Nobu notification workflow runs only after deterministic new valid opportunity; fail-closed on missing evidence; opportunity-key idempotency prevents duplicates. Anti-spam limits + controlled 24h scheduled cadence + production 6h manual cooldown. UI on purchase detail + My Purchases guest/signed-in states. Evidence: `docs/proof/lane-7-3b-email-alerts/`.

**Lane 7.3A purchase intake UX + multi-candidate discovery:** **PASS** - exact mode accepts Target URL alone or TCIN alone; Fill with AI no longer demands a URL when TCIN is valid; link-derived provisional titles with SerpApi enrichment; Demo options removed from production form; uncertain-product mode returns bounded Target multi-candidates with offer_id preserved through cookie snapshot; monitoring remains confirmation-gated. Local proof: 317 unit tests, typecheck, build, Playwright consumer-flow. Evidence: `docs/proof/lane-7-3a-purchase-intake/`.

**Lane 7.3A.1 adaptive product discovery:** **PASS** (`NOBU_LANE_7_3A_1_PASS`) - mode selector removed; one product-details form; Find my product gated on usable product clue; adaptive single/multi/no-results review with radio selection UI; no auto-select or auto-confirm; monitoring still fingerprint-locked. Runtime commit `b2d99b2`; closeout `bf80345`; 2026-07-20 re-verified (323 unit tests, typecheck, build, adaptive + consumer e2e). Canonical production `dpl_6ymuDrXsEhzjteQo5r3qJw5PxK85` / `usenobu-q8b2rrhqj…` on `usenobu.vercel.app` (afterbuy auto-alias cleaned). ASP #5541 read-only unchanged (under review). Evidence: `docs/proof/lane-7-3a-1-adaptive/`.

## Locked decisions

- Product: **AI agent** for post-purchase price monitoring
- Deployment: **UseNobu** at **https://usenobu.vercel.app**
- Live retailer: **Target only**
- Agent API: `POST /v1/agent`
- AI extraction: **Groq**
- Free A2MCP first; no x402


**Lane 7.2 exact identity confirmation split:** **PASS** - user-provided exact Target URL/TCIN identity is now distinct from third-party SerpApi price observations; valid exact identity can be reviewed and confirmed even when live provider discovery has no strong candidate, while monitoring still requires locked-fingerprint matching against later observations and fails closed on uncertainty. Local proof passed (298 tests, typecheck, build, e2e), and a unique Vercel production deployment (`https://usenobu-hfviza4u4-dtwoflicks-2878s-projects.vercel.app`, not aliased to `usenobu.vercel.app`) proved the identity-only candidate, confirmation, locked fingerprint, monitoring gate, and fail-closed live observation behavior. Production proof also surfaced and fixed a pre-existing (Lane 7.1-era) cookie-snapshot bug that dropped `offer_id` and broke server-side confirmation on multi-instance Vercel. Evidence: `docs/proof/lane-7-2-exact-identity/`.

**Lane 7.1 product selection + locked fingerprint repair:** **PASS** - candidate confirmation now posts only a candidate id; server reloads the stored discovery snapshot, enforces a 30-minute freshness bound, revalidates the selected offer against the purchase, rejects tampered/stale/weak/title-only/non-Target/Target Plus/wrong-identity selections, and monitoring remains locked-fingerprint-only/fail-closed.
## Production

**Identity release (2026-07-19):** `https://usenobu.vercel.app` now points to
the verified, unique Lane 7.2 deployment (`dpl_DQ9ULj9uukY1Kdtujxqkf8sppeUw`,
built from clean final HEAD `e927b07`). Canonical production proof passed
(identity-only candidate, confirmation, locked fingerprint, monitoring gate,
fail-closed live observations, no secrets). Legacy alias `afterbuy.vercel.app`
was retired (removed) after confirming ASP #5541's endpoint already used the
canonical URL. `nobu-app.vercel.app`, `get-nobu.vercel.app`,
`nobu-watch.vercel.app`, `nobu-price.vercel.app`, and `nobu-mvp.vercel.app`
remain unchanged (still on the old `afterbuy-hvj2pbrmg-…` build). ASP #5541
inspected read-only: still `PENDING_REVIEW` (`approvalStatus: 2`, not
publicly listed), endpoint and fee unchanged, no edit performed. Evidence:
`docs/proof/nobu-identity-release/`.

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

**Lane 8 — reviewer-status monitoring** (ASP #5541 under review) is the exact next lane after 7.3B.
Then: **Lane 9 — Demo and submission closeout**.

Evidence: `docs/proof/okx/`, `docs/proof/ui/core-product-proof/`, `docs/proof/lane-7-3a-purchase-intake/`, `docs/proof/lane-7-3a-1-adaptive/`, `docs/proof/lane-7-3b-email-alerts/`
