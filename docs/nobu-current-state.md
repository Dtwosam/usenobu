# Nobu Current State

**Date:** 2026-07-20
**Status:** LANE 7.4C.1 PASS — PRE-PAYMENT ACTIVATION AND ROADMAP REPAIR; NEXT LANE 7.4D.0 (OFFICIAL OKX PAID-SERVICE TOPOLOGY RE-CHECK)

ASP #5541 remains free and unchanged while under review. Paid `$0.99` agent-native monitoring is approved planned work, gated on official OKX marketplace-topology proof (Lane 7.4D.0) and, later, an accurate edit/resubmit of `#5541` (Lane 8R) — not on waiting for the current review of `#5541` to resolve first. It is not deployed or guaranteed. Development continues through Lane 7.4D–7.4F without editing or resubmitting `#5541` and without exposing unfinished paid behavior publicly; see "Next active lane" below for the full adopted order.
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

**Lane 7.4C.1 pre-payment activation and roadmap repair:** **PASS** (`NOBU_LANE_7_4C_1_PASS`) — repairs a genuine bug in Lane 7.4C: `PREFLIGHT_MONITORING` called `confirmAndPersistLockedFingerprint`, which sets `purchases.status = 'MONITORING_ACTIVE'` — meaning a free, unauthenticated-by-payment agent action could start real monitoring before any payment existed. Fixed by adding `confirmAndPersistLockedFingerprintPending` (`src/matching/store.ts`) — identical fingerprint-lock/persist logic (both now share one internal `persistConfirmedFingerprint` helper), but the purchase is left in a new truthful, scheduler-ineligible status, `MONITORING_PAYMENT_READY_STATUS` (`"MONITORING_PAYMENT_READY"`); the consumer web confirmation flow's `confirmAndPersistLockedFingerprint` is byte-for-byte unchanged and still activates monitoring immediately (verified by a direct regression test). The scheduler's own selection functions (`selectActivePurchases`, `loadScheduleRows`) already select strictly on `status === "MONITORING_ACTIVE"`, so no scheduler code changed — the new status is automatically excluded. Also fixed failure-recovery: `PREFLIGHT_MONITORING` now always checks whether the reserved purchase id's row actually exists before proceeding, and inserts it if missing (recovering a prior reservation that crashed before insertion, using the reserved id — never a new one); a quote-issuance failure with no recoverable existing quote now returns a graceful `{ error: "quote_issuance_failed" }` (HTTP 503) instead of throwing, and — since the fingerprint step never sets `MONITORING_ACTIVE` — never leaves an active purchase behind either way. Retries and real concurrent calls (`Promise.all`-verified) still produce exactly one purchase and one active quote. Only Lane 7.4D's `START_MONITORING`, after verified payment, may transition a purchase to `MONITORING_ACTIVE`. Also corrects the roadmap: the blocking "wait for ASP #5541 approval before any further 7.4 development" gate is removed — see the Next active lane section below for the adopted order. Evidence: `docs/proof/lane-7-4c-agent-preflight/` (updated).

**Lane 7.4C free agent-native discovery, confirmation, consent and monitoring preflight:** **PASS** (`NOBU_LANE_7_4C_PASS`, repaired by 7.4C.1 above) — implements the remainder of the Lane 7.4A.1 architecture ahead of payment: durable `discovery_sessions` / `monitoring_enrollment_quotes` tables in the same durable AuthStore as `auth_accounts` / `agent_connections`. `DISCOVER_PRODUCT` (no connection required) accepts only validated structured purchase fields (never raw purchase text) and reuses the existing live Target discovery client plus the bounded, Target-Plus-excluding multi-candidate evaluator (`src/matching/discovery-candidates.ts`, max 5 candidates); stores a validated structured snapshot and the bounded candidate snapshot on a 30-minute-TTL session, with no durable owned purchase and no private monitoring state exposed. `CONFIRM_PRODUCT` (no connection required) reloads the durable snapshot, enforces freshness, and reuses `src/matching/confirm.ts` (pure function, no DB writes) to lock a fingerprint against the discovery session only — rejecting stale/tampered/non-Target/Target-Plus/weak/title-only candidates with the same rules as the consumer web confirmation flow; still no purchase row. `PREFLIGHT_MONITORING` requires a Lane 7.4B verified connection and both `monitoring_consent`/`email_alert_consent` explicitly true; on pass it atomically materializes exactly one account-owned purchase from the confirmed session and attaches the locked fingerprint only after the existing deterministic Target eligibility/window check passes — **the original 7.4C pass incorrectly activated monitoring at this step; the 7.4C.1 repair above corrects this to a non-active pre-payment status** — then mints an expiring `$0.99 USD` quote (settlement fields `NULL`, undecided until Lane 7.4D) and returns `MONITORING_PAYMENT_READY`; ineligible purchases get a durable purchase row but never a fingerprint or a quote — the existing locked policy status (`UNSUPPORTED_PURCHASE`/`POLICY_EXCLUSION`/`WINDOW_EXPIRED`/`POLICY_STALE`) is returned as-is. An atomic discovery-session reservation plus a partial-unique active-quote database index make retries and real concurrent calls (`Promise.all`-verified) create no duplicate purchase or quote. Wired additively into the existing bounded `/v1/agent` dispatcher; the three original live actions and the three Lane 7.4B agent-connection actions are unchanged. No payment/x402/`START_MONITORING`/activation-ledger/monitor-management/scheduler code added; ASP #5541 not deployed, edited, or resubmitted. Evidence: `docs/proof/lane-7-4c-agent-preflight/`.

**Lane 7.4B agent connection and conversational email verification:** **PASS** (`NOBU_LANE_7_4B_PASS`) — implements §3.2–§3.5 of the Lane 7.4A.1 architecture: durable `agent_connections` / `agent_email_codes` tables in the same durable AuthStore as `auth_accounts` (Postgres production, SQLite tests/local, never per-instance storage or the browser cookie snapshot). `BEGIN_EMAIL_VERIFICATION` sends an exactly-six-digit cryptographically secure code (rejection-sampled, no modulo bias) through the existing Resend-backed email provider pattern; never reveals whether the email already has an account. `VERIFY_EMAIL_CODE` enforces a 10-minute expiry, a 5-wrong-attempt limit (then a fresh `BEGIN_EMAIL_VERIFICATION` is required), and atomic one-time consume (concurrent/replayed verification loses); on success it upserts+verifies the email account (no browser session/cookie), activates the connection, and mints a high-entropy `connection_token` returned exactly once (stored only as `connection_token_hash`). A shared `authorizeAgentConnection` helper requires both the non-secret `connection_id` handle and a valid unexpired token matching the stored hash — unknown/missing/wrong/expired/revoked credentials all return the same generic `ACTION_NOT_AUTHORIZED`; success updates `last_used_at`. `REVOKE_AGENT_CONNECTION` requires valid authorization and returns the new `CONNECTION_REVOKED` status. An internal rotation helper replaces the token hash and immediately invalidates the old token. Wired additively into the existing bounded `/v1/agent` dispatcher; the three pre-existing live actions are unchanged. No discovery/confirmation/consent/preflight/quotes/payments/x402/monitoring/monitor-management code added; ASP #5541 not deployed, edited, or resubmitted. Evidence: `docs/proof/lane-7-4b-agent-connection/`.

**Lane 7.4A.1 official-OKX source cleanup and agent-monitoring contract repair:** **PASS** (`NOBU_LANE_7_4A_1_PASS`) — documentation and proposed-contract repair only; no implementation, deployment, or ASP #5541 change. Removed `x402.org`, Cloudflare, this environment's packaged Claude/Anthropic skills, WebSearch synthesis, the Solana `SettlementCache` detail, and generic MCP/x402 precedent from the Lane 7.4 authority chain — none of them may support an OKX-specific claim; kept only as a historical record of what was removed and why. Retained OKX official facts (coordinator-provided, this session still could not reach `web3.okx.com`/`www.okx.com`/`okx.ai` directly): registration takes service name, description, price per call, one endpoint, price `0` = free; endpoint is free-direct-200 or x402-402-then-replay; seller flow is protected request → 402 challenge → signed payment → replay; official X Layer example (`eip155:196`, USD₮0, `0x779ded0c9e1022225f8e0630b35a9b54be713736`, 6 decimals, `990000` base units = `$0.99`); OKX's reverse-proxy infrastructure can technically carry free and paid routes but this does not prove one listing may mix them. Kept unresolved: whether one A2MCP listing may mix free/paid actions; whether Nobu may hold multiple differently priced listings; whether ASP #5541 may change price under review; whether OKX forwards identity/email; whether OKX forwards a reusable cross-call credential. Repaired the agent flow (discovery via an unauthenticated `discovery_session_id` before any identity check; no durable owned purchase or private monitoring state before a verified connection), the authorization model (`connection_id` handle + secret `connection_token`/hash/expiry/rotation/revocation), consent (`monitoring_consent` + `email_alert_consent` both durable before a quote), the payment-ready status name (`MONITORING_PAYMENT_READY`, not `PAYMENT_REQUIRED`), payment idempotency (server-derived `activation_key`, no caller-supplied key, valid replay is `200 ALREADY_ACTIVE` never `409`), the settled-but-uncommitted reconciliation case, and the stop-vs-archive split (`monitoring_stopped_at`/`monitoring_stop_reason`, excluded from scheduler selection, never implying a refund). Removed the duplicated Option A/Option B description; replaced with three unresolved topology possibilities, none selected. Inserted an explicit Lane 8 gate before Lane 7.4D. Live `openapi/nobu-a2mcp.openapi.yaml` unchanged. Evidence: `docs/nobu-okx-agent-native-paid-monitoring-architecture.md`, `openapi/nobu-agent-native-paid-monitoring-proposed.openapi.yaml`, `docs/external-source-registry.md`.

**Lane 7.4A OKX agent-native paid monitoring research + architecture:** **PASS** (`NOBU_LANE_7_4A_PASS`, superseded by the 7.4A.1 repair above) — research/documentation-only lane; no implementation, deployment, or ASP #5541 change.

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

**Lane 7.4D.0 — Official OKX paid-service topology re-check** is the exact next lane after 7.4C.1.

**Adopted roadmap (Lane 7.4C.1 repair):** `7.4C.1 → 7.4D.0 official OKX topology re-check → 7.4D → 7.4E → 7.4F → Lane 8R accurate edit/resubmit of #5541 → 7.4G → Lane 9`. The old blocking "wait for ASP #5541 approval before any further 7.4 development" gate is removed — development proceeds through 7.4D–7.4F while `#5541` sits under review, unedited. During 7.4D–7.4F: do not edit or resubmit `#5541`; do not expose unfinished paid behavior publicly; use only official OKX evidence for topology decisions. Lane 8R (after 7.4F, before 7.4G) is the first point at which `#5541` is edited/resubmitted — accurately, reflecting what is genuinely built by then. Lane 7.4D itself still opens with the OKX paid-service topology capability re-check and returns `NOBU_LANE_7_4D_BLOCKED` if topology remains unresolved from official OKX evidence.

Evidence: `docs/proof/okx/`, `docs/proof/ui/core-product-proof/`, `docs/proof/lane-7-3a-purchase-intake/`, `docs/proof/lane-7-3a-1-adaptive/`, `docs/proof/lane-7-3b-email-alerts/`, `docs/proof/lane-7-4b-agent-connection/`, `docs/proof/lane-7-4c-agent-preflight/`
