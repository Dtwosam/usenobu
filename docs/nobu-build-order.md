# Nobu Active Build Order

**Status:** ACTIVE BUILD ORDER  
**Date:** 2026-07-13

The build proceeds lane by lane. A lane closes only when its required proof passes.

## Lane 0 — Source-of-truth adoption and repository baseline

- Add this pack to the repository.
- Create baseline README and environment example.
- Record framework/database/deployment choices in an ADR if they differ from the reference stack.
- Confirm clean git status.
- No product implementation yet.

**Proof:** required files present; mandatory-doc check; no secrets.

## Lane 1 — Domain schemas and deterministic contracts

- Purchase input schema.
- Product candidate and locked fingerprint schema.
- Price observation schema.
- Target policy result schema.
- Status enums.
- Database migrations.
- Pure unit tests.

**Proof:** schema validation and migration tests pass.

## Lane 2 — Target policy engine

- Implement supported online channel and geography.
- Implement 14-day calculation.
- Implement exclusions represented in user input/data.
- Implement fail-closed unknown conditions.
- Bind responses to policy ID/version.

**Proof:** full Target policy fixture matrix passes.

## Lane 3 — SerpApi connector and live capability audit

- Add server-side client.
- Normalize Google Shopping response.
- Add safe error/rate-limit handling.
- Run a bounded live query for a selected Target product.
- Record whether a Target offer, stable identifiers, price, URL, seller, and timestamp are available.
- Do not implement optimistic matching until the live audit proves available fields.

**Proof:** redacted live response fixture, field report, search-count record, no key leakage.

## Lane 4 — Candidate matching and product confirmation

- Generate Target-only candidates.
- Implement strong identifier/model matching.
- Require user confirmation before monitoring.
- Store locked fingerprint.
- Reject title-only and ambiguous matches.

**Proof:** exact match, wrong model, wrong seller, Target Plus, ambiguous, and variant mismatch tests pass.

## Lane 5 — Price monitoring loop

- Active-window selection.
- Search-budget guard.
- Scheduled/manual check runner.
- Price observation history.
- Lower-price detection.
- Expiry handling.
- Idempotent repeated checks.

**Proof:** simulated price drop produces one alert; replay does not duplicate it; expired purchase is not checked.

## Lane 6 — Consumer web flow

- Add purchase.
- Review/confirm candidate.
- Monitoring dashboard.
- Alert/result page.
- Target official action instructions.
- Supported-case and privacy notices.

**Proof:** end-to-end browser path using real provider data where available and clearly labelled fixtures where not.

## Lane 7 — Free A2MCP endpoint

- Implement OpenAPI contract.
- Public HTTPS deployment.
- HTTP 200 JSON response.
- Rate limiting and input validation.
- Health endpoint.
- Curl proof.

**Proof:** external curl succeeds; ambiguous match fails closed; no sensitive data in output.

## Lane 7.1 - Candidate product selection and locked-fingerprint repair COMPLETE

- Return bounded Target-sold candidate lists when supplied purchase information cannot identify one exact product confidently.
- Show differentiating candidate fields: image availability, title, model/TCIN/UPC, variant attributes, observed price, Target/observed URL, seller, and SerpApi Google Shopping provenance.
- Require explicit user confirmation before creating a locked product fingerprint or starting monitoring.
- Confirm by candidate id only; reload and revalidate the server-stored discovery snapshot before locking.
- Reject non-Target sellers, Target Plus, title-only matches, wrong variants, wrong models, stale candidates, tampered candidate ids, and ambiguous/weak selections.
- Later monitoring uses only the locked fingerprint and suppresses positive alerts on uncertainty.

**Proof:** focused confirmation tests, matching tests, monitoring tests, SerpApi normalization tests, web integration tests, typecheck, and browser consumer-flow pass.

## Lane 7.2 - Exact identity confirmation split COMPLETE

- Separate user-provided exact purchase identity from third-party SerpApi price observations.
- Allow valid Target URL/TCIN identity to become a reviewable confirmation candidate even when live SerpApi discovery has no strong candidate or is unavailable.
- Preserve explicit user confirmation before fingerprint lock and monitoring.
- Keep later monitoring locked-fingerprint-only; every third-party price observation must independently match the locked fingerprint and fail closed on ambiguity or mismatch.
- Preserve Target-only MVP, Target Plus exclusion, no Target scraping, no official Target API price claim, and no guaranteed refund language.

**Proof:** focused confirmation, matching, monitoring, live-discovery, SerpApi normalization/enrichment, manual-check, full unit suite, typecheck, build, and consumer Playwright path pass locally, and the unique Vercel production deployment proof (identity-only candidate, no price, required confirmation, server-side success, locked fingerprint, monitoring blocked/active, fail-closed live observation, no positive alert, Nobu identity, no secrets) also passed. Production proof surfaced and fixed a pre-existing cookie-snapshot `offer_id` bug that blocked confirmation on multi-instance Vercel. Evidence: `docs/proof/lane-7-2-exact-identity/`.

## Lane 7.3A - Purchase intake UX repair + multi-candidate discovery COMPLETE

- Two product-entry modes: exact (Target URL **or** TCIN) and help-me-find (description-first).
- Fill with AI validation accepts URL or TCIN (never demands URL when TCIN is valid).
- Link-derived provisional titles; third-party enrichment may improve them; provider failure preserves fallback.
- Demo options removed from production `/purchases/new`.
- Uncertain-product multi-candidate discovery (3–6 Target candidates, Target Plus excluded, deduped).
- Never auto-confirms; title-only blocked; `offer_id` preserved through session-snapshot compaction.
- Monitoring remains blocked until explicit confirmation and fingerprint lock.

**Proof:** focused form/AI-fill, uncertain discovery, candidate-confirmation, session-snapshot, matching, monitoring, SerpApi normalization, full unit suite (317), typecheck, build, Playwright consumer-flow pass. Evidence: `docs/proof/lane-7-3a-purchase-intake/`.

## Lane 7.3A.1 - Adaptive product discovery (no mode selector) COMPLETE

- Remove exact/find mode selector from `/purchases/new`.
- One unified product-details section: title, URL, TCIN, model, UPC, colour, size, quantity, price, date, channel/location.
- Find my product gated until price, date, and at least one usable product clue.
- Adaptive discovery: one strong candidate, 3–5 multi-candidate selection, or insufficient/no-results.
- Multi-candidate radio cards with sticky continue; final confirmation still required; no auto-select/confirm.
- Monitoring remains fingerprint-locked and fail-closed.

**Proof:** unit suite, adaptive Playwright, consumer-flow, typecheck, build, unique + canonical Vercel proof. Evidence: `docs/proof/lane-7-3a-1-adaptive/`.

## Lane 7.3A.2A - Account-private My Purchases + no production demo data COMPLETE

- My Purchases is account-private: every purchase has exactly one server-assigned owner (`usr_*` from httpOnly session cookie).
- Never trust client-supplied user/owner/email for ownership.
- Owner-scope consumer list, read, confirm, manual check, observations, alerts; cross-user and missing → generic **Purchase not found**.
- Ownerless and legacy shared `demo-user` rows quarantined (not reassigned; redacted count only).
- Remove production **Demo data** banner from My Purchases; fixtures only under explicit test/e2e gate.
- Scheduler/internal monitoring keeps a separate protected boundary (may process across owners).
- Small privacy reassurance under My Purchases heading.

**Proof:** privacy unit tests, fixture isolation, scheduler/monitoring regressions, typecheck, build, Playwright two-user privacy + consumer-flow. Verdict: `NOBU_LANE_7_3A_2A_PASS`.

## Lane 7.3A.2A.1 - Passwordless accounts + guest claim

- Passwordless email magic link (no passwords); verified email before account ownership.
- Guests keep `nobu_owner_v1`; accounts use stable `acct_*` ids.
- Guest purchases claimable only from the browser holding the guest cookie; atomic, idempotent.
- Sign-in UI, guest notice, claim success, account menu, logout toast.
- Logout never deletes history; never moves account purchases back to guest.

**Proof:** auth unit tests, privacy regressions, Playwright account-auth + consumer-flow, typecheck, build.

## Lane 7.3A.2A.1R - Magic-link + durable auth repair

- Durable Postgres AuthStore (accounts, tokens, sessions, claims, account purchase blobs).
- Auth not stored in browser cookie snapshot; cookies are opaque only.
- GET `/auth/verify` peeks only; POST “Continue signing in” consumes once (email previews safe).
- Magic-link origin: `https://www.usenobu.xyz`; A2MCP stays on `usenobu.vercel.app`.

**Proof:** focused auth unit tests, purchase-privacy regressions, Playwright 1R flow, typecheck, build.

## Lane 7.3A.2B - Persistent purchase history and lifecycle interface COMPLETE

- Signed-in durable history via account purchase blobs (Postgres).
- Tabs: Active / History / Archived; archive is visibility-only.
- User-reported Target outcome (unverified disclosure).
- Archive, restore, permanent delete (owner-scoped).
- Guests retain local lists; cross-device requires sign-in.

**Proof:** lifecycle unit tests, privacy/auth regressions, Playwright lifecycle UI, typecheck, build.

## Lane 7.3B — Consented automatic price-drop email alerts COMPLETE

- Purchase-level consent: **Email me about possible price drops** (off until enabled; durable consent timestamp).
- Sends only to the verified Nobu account email (masked in UI); guests must sign in; no second email field.
- Nobu receives eligible alert events after deterministic monitoring, prepares purchase-specific copy from validated evidence only, triggers email, and records Nobu-initiated notification.
- Durable opportunity-key idempotency; anti-spam (1/purchase/24h, 3/account/24h, summary thereafter).
- Controlled schedule: ≤1 scheduled provider check / purchase / 24h; batch + budget bounds; manual Check now ≤6h in production.
- Scheduler: `POST /v1/owner/monitor-scheduler` (CRON_SECRET).

**Proof:** focused email-alert unit tests, migration 0007, monitoring regression, Playwright preference UI (incl. 390px), typecheck, build. Evidence: `docs/proof/lane-7-3b-email-alerts/`.

## Lane 7.4A — OKX agent-native paid monitoring research and architecture COMPLETE (repaired by 7.4A.1)

- Research-and-documentation-only lane; no implementation, deployment, production API change, or ASP #5541 edit/resubmission.
- Audit official OKX/Onchain OS/A2MCP/x402 capabilities; record confirmed, unresolved, and blocked findings in `docs/external-source-registry.md`.
- Select agent-native short-code email verification as Nobu's permanent identity architecture (not an OKX-proof-pending fallback).

**Proof:** `docs/nobu-okx-agent-native-paid-monitoring-architecture.md` and `openapi/nobu-agent-native-paid-monitoring-proposed.openapi.yaml` present and internally consistent; `docs/external-source-registry.md` records every material finding with source and status; live `openapi/nobu-a2mcp.openapi.yaml` unchanged; ASP #5541 unchanged. Verdict: `NOBU_LANE_7_4A_PASS`. **Note:** the original 7.4A pass cited non-OKX sources (x402.org, Cloudflare, a packaged environment skill, web search synthesis) to corroborate OKX-specific claims and drew a topology inference from them; Lane 7.4A.1 removed those citations from the Lane 7.4 authority chain and repaired the affected sections — see Lane 7.4A.1 below.

## Lane 7.4A.1 — Official-OKX source cleanup and agent-monitoring contract repair COMPLETE

- Documentation and proposed-contract repair only; no implementation, deployment, production API change, or ASP #5541 edit/resubmission.
- Removed `x402.org`, Cloudflare, packaged Claude/Anthropic skills, WebSearch synthesis, Solana `SettlementCache`, and generic MCP/x402 precedent from the Lane 7.4 authority chain for OKX-specific claims; retained them only as a historical record of what was removed and why.
- Adopted coordinator-provided official OKX findings: registration is one price per call per endpoint (price `0` = free); an endpoint is documented as free-direct-200 or x402-402-then-replay; seller flow is protected-request → 402 challenge → signed payment → replay; official X Layer example (`eip155:196`, USD₮0, `0x779ded0c9e1022225f8e0630b35a9b54be713736`, 6 decimals, `990000` base units = `$0.99`); OKX's reverse-proxy infrastructure can technically carry free and paid routes but this does not prove one A2MCP listing may mix them.
- Repaired the agent flow order (discovery before identity, via an unauthenticated expiring `discovery_session_id`; no durable owned purchase or private monitoring state before a verified connection), the authorization model (`connection_id` handle + secret `connection_token`/`connection_token_hash`/`credential_expires_at`/`credential_rotated_at`/revocation), the consent contract (both `monitoring_consent` and `email_alert_consent` durable before a quote), the payment-ready status name (`MONITORING_PAYMENT_READY`, reserving real `402`/`PAYMENT-REQUIRED` for the OKX resource itself), payment idempotency (server-derived `activation_key`, no caller-supplied key, valid replay is `200 ALREADY_ACTIVE` never `409`), the reconciliation case for a settled-but-uncommitted activation, and the stop/archive split (`monitoring_stopped_at`/`monitoring_stop_reason`, distinct from archive, excluded from scheduler selection).
- Removed the duplicated Option A/Option B topology description; replaced with three unresolved possibilities (mixed listing, separate listings, convert-and-relocate), none selected.
- Inserted an explicit Lane 8 gate before Lane 7.4D: no paid marketplace modification before ASP #5541 is approved and genuinely live.

**Proof:** `docs/nobu-okx-agent-native-paid-monitoring-architecture.md`, `openapi/nobu-agent-native-paid-monitoring-proposed.openapi.yaml`, and `docs/external-source-registry.md` repaired and internally consistent; non-OKX-source scan of all Lane 7.4 files clean; live `openapi/nobu-a2mcp.openapi.yaml` unchanged; ASP #5541 unchanged. Verdict: `NOBU_LANE_7_4A_1_PASS`.

## Lane 7.4B — Agent connection and conversational email verification COMPLETE

- Durable `agent_connections` / `agent_email_codes` tables (same durable AuthStore as `auth_accounts` — PostgreSQL production, SQLite tests/local, not per-instance storage or the browser cookie snapshot).
- `BEGIN_EMAIL_VERIFICATION`, `VERIFY_EMAIL_CODE`, `REVOKE_AGENT_CONNECTION` actions: exactly-six-digit cryptographically secure (rejection-sampled), 10-minute-expiry, single-use, 5-attempt-limited, per-email/per-source rate-limited, hashed-at-rest codes; `connection_id` (non-secret handle) plus high-entropy `connection_token` (secret credential, returned once, stored only as `connection_token_hash`) with expiry and an internal rotation helper; a shared `authorizeAgentConnection` helper returns the same generic `ACTION_NOT_AUTHORIZED` for unknown/missing/wrong/expired/revoked credentials. A connection cannot authenticate the website (no session/cookie ever created) and cannot read purchases beyond what it created.
- Does not require the Lane 7.4D payment-topology decision.

**Proof:** `tests/auth/agent-connections.test.ts` (12 focused tests: code expiry/attempt-limit/one-time-consume, token hashed-and-returned-once, handle-only/wrong/expired/revoked rejection, rotation invalidating the old token, revocation, cross-connection isolation, existing `/v1/agent` actions unchanged), focused auth regressions (8 passed), combined targeted run (192 passed / 20 files), typecheck, build, `git diff --check` clean, sensitive-output scan clean. Verdict: `NOBU_LANE_7_4B_PASS`. Evidence: `docs/proof/lane-7-4b-agent-connection/`.

## Lane 7.4C — Free agent-native discovery, confirmation, consent and monitoring preflight COMPLETE

- `DISCOVER_PRODUCT`, `CONFIRM_PRODUCT` (reusing `src/matching/discovery-candidates.ts` / `src/matching/confirm.ts`) against an unauthenticated, expiring `discovery_session_id` — no connection required, no durable owned purchase created yet. Discovery accepts only validated structured purchase fields (never raw purchase text) and returns bounded (max 5) Target-only candidates via the existing live Target discovery client; Target Plus and non-Target sellers excluded.
- Durable `monitoring_consent` + `email_alert_consent` capture; `PREFLIGHT_MONITORING` authorizes via the Lane 7.4B shared connection helper, materializes the connection-owned purchase from the confirmed discovery session, attaches the locked fingerprint only after the deterministic Target eligibility/window check passes, and on full pass mints a durable, expiring `monitoring_enrollment_quotes` row ($0.99 USD, settlement fields `NULL` pending Lane 7.4D) and returns `MONITORING_PAYMENT_READY` (not `PAYMENT_REQUIRED` — that name is reserved for the real OKX `402` resource).
- Unsupported/ambiguous/expired-session purchases, or purchases missing either consent, never reach a quote — the existing locked policy status is returned as-is.
- Idempotent: an atomic discovery-session reservation plus a partial-unique active-quote index guarantee retries/concurrency never create a duplicate purchase or quote (verified under real `Promise.all` concurrency).
- Did not require the Lane 7.4D payment-topology decision.

**Proof:** `tests/web/agent-preflight.test.ts` (12 focused tests: discovery-without-identity creates no purchase, bounded Target-only candidates, confirmation rejection cases, session-bound-fingerprint-only confirmation, preflight auth/consent rejection, unsupported/ambiguous/expired create no quote, supported creates one purchase + one quote, retries/concurrency create no duplicates, Lane 7.4B + original actions unchanged, full dispatch path), directly affected regressions (283/284 passed, 1 pre-existing unrelated skip/failure untouched by this lane), typecheck, build, `git diff --check` clean, sensitive-output scan clean. Verdict: `NOBU_LANE_7_4C_PASS`. Evidence: `docs/proof/lane-7-4c-agent-preflight/`.

## Lane 8 gate — ASP #5541 approval and genuine live-listing proof

- ASP #5541 must be approved and genuinely, publicly live (per the existing Lane 8 definition later in this document: "Proof for PASS: approved, live listing. Do not claim completion before this exists.") before any paid marketplace modification is attempted.
- No paid marketplace modification of any kind — no listing edit, no new listing, no price change — before this gate passes.

## Lane 7.4D — Official OKX paid-topology re-check and `$0.99` activation

- **Opens with "OKX paid-service topology capability re-check"**, using only official OKX documentation available at that time: resolve which (if any) of the three documented possibilities (mixed listing / separate listings / convert-and-relocate) is supported, whether ASP #5541 may change price under review, whether OKX forwards identity/email, and whether OKX forwards a reusable cross-call authorization credential. **If topology remains unresolved, return `NOBU_LANE_7_4D_BLOCKED`.**
- Only once resolved: implement the confirmed topology, `payment_attempts` / `monitor_activations` ledgers, `START_MONITORING` with a server-derived `activation_key` (no caller-supplied idempotency key), exactly-once activation in one durable transaction, replay-safe `200 ALREADY_ACTIVE` (never `409` for a valid replay), fail-closed expired/altered-quote handling, and the settled-but-uncommitted reconciliation job.

**Proof:** payment-challenge/settlement/idempotency unit tests, duplicate-replay test (exactly one monitor, `200 ALREADY_ACTIVE`), expired/altered-quote fail-closed test, reconciliation-job test, typecheck, build.

## Lane 7.4E — Agent-native monitor management

- `LIST_ACTIVE_MONITORS`, `ENABLE_EMAIL_ALERTS`/`DISABLE_EMAIL_ALERTS`, `STOP_MONITORING`; `CHECK_MONITORING_STATUS` (already live) confirmed compatible.
- `STOP_MONITORING` sets an explicit `monitoring_stopped_at`/`monitoring_stop_reason = user_requested` state, distinct from the visibility-only Lane 7.3A.2B archive; scheduler selection excludes stopped purchases. No refund promises in any response text.

**Proof:** owner-scope, stop-vs-archive, and scheduler-exclusion regression tests, typecheck, build.

## Lane 7.4F — Scheduler and notification integration

- Prove agent-originated paid monitors flow through the existing `src/monitoring` scheduler and Lane 7.3B `src/notifications` email pipeline unmodified — no parallel scheduler or notification system.

**Proof:** scheduler/notification regression tests covering an agent-originated monitor alongside a web-originated one.

## Lane 7.4G — Live marketplace end-to-end proof

- Prove: agent request → product confirmation → email verification → consent → genuine `$0.99` payment → monitor activation → scheduled monitoring → genuine eligible email alert → status retrieval → duplicate suppression.

**Proof:** end-to-end evidence bundle covering every step above with no fake payments, users, revenue, transactions, or alerts.

Then **Lane 9 — Demo and submission closeout** (defined later in this document) after the applicable 7.4 proof.

## Lane 7.5A — Global Nobu rename

- Rename active project identity to Nobu across UI, docs, package metadata, OpenAPI, prompts, env names, and source comments.
- Keep A2MCP routes `/health` and `/v1/target-price-check` unchanged.
- Do not change Target policy, matching, monitoring, or HTTP contract behavior.

**Proof:** active repository scan empty of the prior brand; tests, typecheck, and build pass.

## Lane 7.5B1 — Design foundation and reusable UI components

- Design tokens, Manrope typography, global shell (header/footer/mobile nav).
- Reusable components with hover/active/focus/disabled/loading/error states.
- First-time UX rules, accessibility, and foundation proof gallery.
- Do **not** fully redesign product screens in this lane.
- No OKX registration.

**Proof:** design spec, foundation screenshots, component/a11y tests, unit/typecheck/build pass.

## Lane 7.5B2 — Complete screen implementation

- Redesign consumer product screens on the 7.5B1 foundation.
- Preserve product locks, notices, fail-closed flows, and E2E contracts.
- No OKX registration in this lane.

**Proof:** browser path still works; brand and UI updated; tests pass.

## Lane 7.5B3 — Visual QA, polish and deployment

- Visual QA against the design reference and design system.
- Polish spacing, copy, and residual a11y issues.
- Deploy consumer UI only after proof; still no OKX registration until Lane 8.

**Proof:** polished screenshots, residual fixes, deployment evidence if approved.

## Lane 7.5C — UseNobu production identity

- Remove every residual prior-brand string, path, and proof archive from the working tree.
- Vercel project name: `usenobu`.
- Primary production URL: `https://usenobu.vercel.app` (public, no SSO).
- Product name remains Nobu; deployment identity is UseNobu.
- No OKX registration in this lane.

**Proof:** case-insensitive prior-brand repository scan empty; production health and A2MCP checks on usenobu.vercel.app; proof under `docs/proof/usenobu-production/`.

## Lane 7.5D — Universal product positioning

- Position Nobu as a universal post-purchase price-monitoring platform.
- Target remains the first and only live retailer integration.
- Update consumer copy, metadata, and source-of-truth wording without changing Target logic or APIs.
- No other retailers, fake options, or OKX registration.

**Proof:** homepage/add-purchase/notices positioning tests; Target-only logic unchanged; unit/typecheck/build/e2e pass.

## Lane 7.5D.1 — Production Find my product repair

- Fix serverless migration scandir ENOENT and Vercel DB path.
- Cookie snapshot for demo persistence across instances.
- Safe form errors; no blank application-error page.

## Lane 7.5E — Bounded AI agent + NL purchase intake ✅ COMPLETE

- Natural-language intake with confirmation gate.
- `POST /v1/agent` actions: UNDERSTAND_PURCHASE, CHECK_CONFIRMED_PURCHASE, CHECK_MONITORING_STATUS.
- AI extraction never starts matching/monitoring.
- Existing `/v1/target-price-check` unchanged.
- Listing path for Lane 8: `https://usenobu.vercel.app/v1/agent`.

**Proof:** AI unit tests, e2e intake, production browser NL flow, agent API checks under `docs/proof/nobu-ai-agent/`.

## Lane 7.5E.2 — Migrate AI extraction to Groq + activate live provider ✅ COMPLETE

- Replace unactivated xAI path with **Groq** (`GROQ_API_KEY`, default model `openai/gpt-oss-20b`).
- Strict JSON schema extraction; deterministic fallback retained.
- Health: `groq_configured` boolean + model name only.
- Live production: `provider: "groq"` proven.

**Proof:** `docs/proof/nobu-ai-agent/live-groq-provider/` — `NOBU_LANE_7_5E_2_PASS`.

## Lane 8 — OKX ASP registration and live listing (**ACTIVE — PENDING REVIEW**)

- Register free A2MCP ASP using **`https://usenobu.vercel.app/v1/agent`**.
- Accurate listing: AI agent + Target-only live integration.
- Install/use Onchain OS according to current official instructions.
- Register A2MCP ASP with price `0`.
- Submit for review; address reviewer feedback.
- Record live listing evidence only when genuinely approved and public.

**Progress (2026-07-14):** ASP **#5541 Nobu** registered; marketplace **`submitApproval.success: true`**, **`approvalStatus: 2`** (under review). Not publicly live. Evidence: `docs/proof/okx/`. Verdict: **NOBU_LANE_8_PENDING_REVIEW**.

**Progress (2026-07-17):** Listing **rejected** for avatar quality/specs; same agent **#5541** updated avatar-only (440×440 square polished software shield); resubmitted — **`submitApproval.success: true`**, **`approvalStatus: 2`**. Evidence: `docs/proof/okx/lane8-avatar-resubmit-summary.json`. Still **NOBU_LANE_8_PENDING_REVIEW**.

**Review-Safe Sprint A (2026-07-14):** Core product proof — bounded **Check price now**, compact Monitoring Proof panel, short decision explanations. Evidence: `docs/proof/ui/core-product-proof/`. Verdict: **NOBU_REVIEW_SAFE_A_PASS**. Does **not** complete Lane 8.

**Review-Safe Sprint A.1 (2026-07-14):** Production manual check uses **live SerpApi** (fixtures gated for tests/e2e only). Evidence: `docs/proof/ui/core-product-proof/live-manual-check/`. Verdict: **NOBU_REVIEW_SAFE_A_1_PASS**.

**Review-Safe Sprint B (2026-07-14):** Compact **Action Center** for accepted price differences (Open on Target, Contact Target, Copy details, View details). Evidence: `docs/proof/ui/action-center/`. Verdict: **NOBU_REVIEW_SAFE_B_PASS**.

**Review-Safe Sprint C (2026-07-14):** Homepage judge clarity — retailer-neutral hero, money-back benefit, current Target availability, user-testing kit. Evidence: `docs/proof/ui/judge-clarity/`, `docs/user-testing/`. Verdict: **NOBU_REVIEW_SAFE_C_PASS**.

**Review-Safe Sprint A.2 (2026-07-14):** Live product matching evidence — Conair GS14 diagnosis; locked-fingerprint monitoring accepts exact Target URL; query prefers brand+model. Evidence: `docs/proof/live-product-validation/conair-gs14/`. Verdict: **NOBU_REVIEW_SAFE_A_2_PASS**.

**Review-Safe Sprint A.3 (2026-07-14):** Policy freshness re-verified to **2026-07-14**; production Conair LIVE closeout (no POLICY_STALE). Evidence: `docs/proof/live-product-validation/conair-gs14/live-closeout/`. Verdict: **NOBU_REVIEW_SAFE_A_3_PASS**.

**Proof for PASS:** approved, live listing. Do not claim completion before this exists.

## Lane 9 — Demo and submission closeout

- 90-second-or-shorter demo.
- Realistic purchase and observed price flow.
- Clearly identify third-party price source and Target final verification.
- X post with `#OKXAI`.
- Official form with ASP and X link.
- Archive submission evidence.

**Proof:** post URL, duration, form confirmation, live ASP.

## Lane 10 — Optional post-listing enhancements

Only if time remains after Lane 8 proof:

- receipt image parsing;
- email alerts;
- paid x402 monitoring/check service;
- more live Target products;
- capacity dashboard.

No second retailer during the hackathon MVP.
