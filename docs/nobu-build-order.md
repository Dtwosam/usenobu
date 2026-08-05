# Nobu Active Build Order

**Status:** ACTIVE BUILD ORDER
**Date:** 2026-07-13

The build proceeds lane by lane. A lane closes only when its required proof passes.

## Active closeout — Paid-to-free machine continuation FINAL PASS

**State:** FINAL PASS — generic buyer agent completes paid→free setup; fallback paths never solicit machine-owned fields; consent retries preserve `connection_token`.

Repair (2026-08-05) baseline `6e56e07` → fallback `ebe24bd`:

- Sole Production domain `https://www.usenobu.xyz` for free `/v1/agent` and paid `/v1/agent/monitoring-pass`.
- Authoritative `protocol_continuation` on paid issuance and every journey stage.
- Machine-owned values never in user-required fields (including failed pass-resolution); hard sanitizer on contracts.
- Shared consents response always carries token; tokenless consent → `INTERNAL_CONTINUATION_STATE_MISSING`.
- Generic A-to-Z + fallback repair focused tests green.

Exact next lane:

1. Optional operator recovery for pre-repair live pass (no second payment; no user-facing tokens).
2. Optional User-role chat against agent `5541` (at most one **new** payment) only when readiness allows.
3. Do not mutate ASP `#5541` unless a later lane explicitly requires it.

**Closeout proof:** `docs/proof/paid-to-free-machine-continuation/README.md`.
**Current verdict:** `NOBU_PAID_TO_FREE_MACHINE_CONTINUATION_FINAL_PASS`.

## Prior closeout — Paid-to-active transaction LIVE READY / BLOCKED

**State:** superseded as active closeout by paid-to-free machine continuation. Provider-id + summary path remain.

Evidence: `docs/proof/paid-to-active-transaction-live-ready/README.md`.

## Prior closeout — Paid-to-active transaction audit repair FINAL PASS

**State:** superseded by closeout. Evidence: `docs/proof/paid-to-active-transaction-audit-repair/`.

## Prior closeout — Paid-to-active transactional follow-up PASS

**State:** superseded. Evidence: `docs/proof/paid-to-active-transaction-followup/`.

## Prior closeout — Paid-to-active transactional repair PASS

**State:** superseded by follow-up then audit repair.

Evidence: `docs/proof/paid-to-active-transaction-repair/`.

## Prior closeout — OKX User-role marketplace journey repair PASS

**State:** superseded as active closeout by paid-to-active transactional repair.

Evidence: `docs/proof/user-role-journey-repair/`.

## Prior closeout — Complete production hardening

**State:** superseded as active closeout by speed/flow lane (settlement/conversation repairs remain deployed).

Evidence: `docs/proof/complete-production-hardening/`.

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
- Magic-link origin: `https://www.usenobu.xyz`; A2MCP stays on `www.usenobu.xyz`.

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

## Lane 7.4C — Free agent-native discovery, confirmation, consent and monitoring preflight COMPLETE (repaired by 7.4C.1)

- `DISCOVER_PRODUCT`, `CONFIRM_PRODUCT` (reusing `src/matching/discovery-candidates.ts` / `src/matching/confirm.ts`) against an unauthenticated, expiring `discovery_session_id` — no connection required, no durable owned purchase created yet. Discovery accepts only validated structured purchase fields (never raw purchase text) and returns bounded (max 5) Target-only candidates via the existing live Target discovery client; Target Plus and non-Target sellers excluded.
- Durable `monitoring_consent` + `email_alert_consent` capture; `PREFLIGHT_MONITORING` authorizes via the Lane 7.4B shared connection helper, materializes the connection-owned purchase from the confirmed discovery session, attaches the locked fingerprint only after the deterministic Target eligibility/window check passes, and on full pass mints a durable, expiring `monitoring_enrollment_quotes` row ($0.99 USD, settlement fields `NULL` pending Lane 7.4D) and returns `MONITORING_PAYMENT_READY` (not `PAYMENT_REQUIRED` — that name is reserved for the real OKX `402` resource).
- Unsupported/ambiguous/expired-session purchases, or purchases missing either consent, never reach a quote — the existing locked policy status is returned as-is.
- Idempotent: an atomic discovery-session reservation plus a partial-unique active-quote index guarantee retries/concurrency never create a duplicate purchase or quote (verified under real `Promise.all` concurrency).
- Did not require the Lane 7.4D payment-topology decision.
- **Note:** the original 7.4C pass attached the locked fingerprint by calling `confirmAndPersistLockedFingerprint`, which also set `purchases.status = 'MONITORING_ACTIVE'` — meaning `PREFLIGHT_MONITORING` (free, no payment) could start real monitoring. Lane 7.4C.1 repairs this — see below.

**Proof:** `tests/web/agent-preflight.test.ts` (12 focused tests: discovery-without-identity creates no purchase, bounded Target-only candidates, confirmation rejection cases, session-bound-fingerprint-only confirmation, preflight auth/consent rejection, unsupported/ambiguous/expired create no quote, supported creates one purchase + one quote, retries/concurrency create no duplicates, Lane 7.4B + original actions unchanged, full dispatch path), directly affected regressions (283/284 passed, 1 pre-existing unrelated skip/failure untouched by this lane), typecheck, build, `git diff --check` clean, sensitive-output scan clean. Verdict: `NOBU_LANE_7_4C_PASS`. Evidence: `docs/proof/lane-7-4c-agent-preflight/`.

## Lane 7.4C.1 — Pre-payment activation and roadmap repair COMPLETE

- Replaced `PREFLIGHT_MONITORING`'s use of `confirmAndPersistLockedFingerprint` with a new `confirmAndPersistLockedFingerprintPending` (`src/matching/store.ts`, sharing one internal helper with the original so both stay in sync): persists the confirmed locked fingerprint identically, but leaves the purchase in a new truthful, scheduler-ineligible status (`MONITORING_PAYMENT_READY_STATUS` = `"MONITORING_PAYMENT_READY"`) instead of `MONITORING_ACTIVE`. The consumer web confirmation flow's `confirmAndPersistLockedFingerprint` is unchanged and still activates monitoring immediately — verified directly by a regression test. The scheduler already selects strictly on `status === "MONITORING_ACTIVE"` (`src/monitoring/selection.ts`, `src/monitoring/scheduler.ts`), so no scheduler code changed; the new status is automatically excluded.
- Failure-recoverable preflight: after resolving a purchase id (fresh reservation or an already-`materialized` session), the purchase row's existence is always checked and inserted if missing — recovering a prior attempt that crashed between session reservation and purchase insertion, using the reserved id, never a new one. A concurrent recovery race on the same id is caught (primary key conflict) and re-read, never duplicated.
- Quote-issuance failure with no recoverable existing active quote now returns a graceful `{ error: "quote_issuance_failed" }` (HTTP 503) instead of throwing; because the fingerprint-lock step never sets `MONITORING_ACTIVE`, a quote failure structurally can never leave an active purchase either way.
- Retries and real concurrent calls (`Promise.all`-verified) still produce exactly one purchase and one active quote; an existing valid quote is reused.
- Corrected all Lane 7.4C docs and proof that claimed `PREFLIGHT_MONITORING` activates monitoring.
- Roadmap correction: removed the requirement to wait for ASP `#5541`'s current review to resolve before continuing 7.4 development. Adopted order: `7.4C.1 → 7.4D.0 official OKX topology re-check → 7.4D → 7.4E → 7.4F → 8R.0 → 8R.1 → 8R.2 → Lane 8R accurate edit/resubmit of #5541 → 7.4G → Lane 9`. During 7.4D–7.4F: do not edit or resubmit `#5541`; do not expose unfinished paid behavior publicly; use only official OKX evidence for topology decisions.

**Proof:** `tests/web/agent-preflight.test.ts` (15 focused tests, 3 new: preflight creates a fingerprint and quote but never `MONITORING_ACTIVE` and the scheduler cannot select it; recovers on retry after a simulated crash between reservation and insertion; quote-issuance failure never activates monitoring and creates no duplicate; existing 12 tests updated/retained including retries/concurrency create one purchase+quote and existing web confirmation still activates monitoring normally), typecheck, build, `git diff --check` clean. Verdict: `NOBU_LANE_7_4C_1_PASS`. Evidence: `docs/proof/lane-7-4c-agent-preflight/` (updated).

## Lane 7.4D.0 — Official OKX paid-service topology re-check COMPLETE

- Research/documentation-only. Resolved: **separate free and paid A2MCP services, co-located under the existing Agent `#5541` identity** (not a second ASP) — the existing free service is left untouched; a new paid service (own `fee`, own `endpoint`) is added later, in Lane 8R, via `agent update --service` with an `operation: "create"` delta entry.
- Official evidence: the installed official Onchain OS CLI (`onchainos.exe`, v4.2.4) `--help` schema, inspected strictly read-only (`agent create`, `agent update`, `agent activate`, `agent service-list`, `payment pay`, `payment charge` — no state-changing command executed), and the official `github.com/okx/onchainos-skills` repository (`skills/okx-ai/references/identity-register.md`, `identity-update.md`, `identity-invariants.md`; `skills/okx-agent-payments-protocol/SKILL.md` + `_shared/amount-display.md`), reachable this session for the first time since Lane 7.4A (`web3.okx.com` itself remained DNS-blocked).
- Also confirmed: `agent update` never creates a new Agent ID; editing a QA-governed field (name, description, or a service create/update) re-triggers review; X Layer chain id `196` and the USDT-family/6-decimal settlement pattern, independently corroborated from a second official source.
- Genuine remaining gaps (do not block the topology decision): whether `agent update` succeeds during `#5541`'s first, not-yet-reviewed pending state (vs. only proven after a rejection); whether OKX forwards caller identity/email or a reusable cross-call credential to the ASP.
- Did not edit, resubmit, or create an ASP. Did not deploy or implement payment code.

**Proof:** topology-resolution record citing only official OKX/Onchain-OS sources (CLI help schema + official skills repo). Verdict: `NOBU_LANE_7_4D_0_PASS`. Evidence: `docs/proof/lane-7-4d-0-okx-topology/`.

## Lane 7.4D — `$0.99` activation COMPLETE

- Implemented the Lane 7.4D.0-selected topology's payment/activation mechanics: durable `payment_attempts` / `monitor_activations` tables in the same AuthStore as `monitoring_enrollment_quotes`; a private, unregistered `POST /v1/agent/start-monitoring` route accepting only `quote_id`/`connection_id`/`connection_token`; an official x402 `PAYMENT-REQUIRED`/`402` challenge/verification boundary that fails closed in production (no confirmed official seller-side verification contract — only a test-mode-gated fake verifier can report settlement); a server-derived `activation_key` (no caller-supplied idempotency key).
- **Durable two-phase saga, not one cross-store transaction** — the AuthStore's durable Postgres and the purchases database (`src/web/db.ts`, per-instance `/tmp` SQLite in production) are genuinely separate stores, so the originally-proposed "one durable transaction" spanning both was replaced with: phase 1, one real AuthStore transaction (settle payment, consume quote, insert a `pending_projection` activation); phase 2, best-effort projection of `purchases.status` to `MONITORING_ACTIVE` in the other store; phase 3, mark the activation `active` only once phase 2 succeeds. A stuck `pending_projection` row never re-requests payment — `reconcilePendingActivations` retries phase 2 alone from the durable settlement record.
- Idempotency: a request against an already-`active` quote returns `200 ALREADY_ACTIVE` (never `409`) with the original monitor id; against a still-`pending_projection` quote it returns `200 ACTIVATION_PENDING`. Concurrent settlement races resolve via database UNIQUE constraints, with a losing transaction's UNIQUE-violation treated as a lost race (fall through to a post-transaction read), not an error. Expired/altered quotes fail closed before any payment attempt exists. This is the only lane that may transition a purchase to `MONITORING_ACTIVE` from an agent-native quote. Registering the actual new paid service on `#5541` is a Lane 8R action, not this lane's.
- Did not edit or resubmit `#5541`; did not expose unfinished paid behavior publicly; did not deploy.

**Proof:** `tests/payments/start-monitoring.test.ts` (9 focused tests): invalid auth/quote issues no challenge; unpaid request gets a correctly quote-bound 402; a rejecting verifier never activates; first settlement creates exactly one payment+activation; concurrent duplicate settlement produces one settled payment and one activation with both callers resolving to the same monitor id; a purchases-store outage at settlement yields `ACTIVATION_PENDING` (never a second charge) and reconciliation later activates exactly once; expired and price-altered quotes fail closed; existing free `/v1/agent` actions unaffected. Directly-affected regressions (agent-preflight, agent-connections, passwordless-auth, monitoring, a2mcp, locked-fingerprint-monitor) pass unchanged. Typecheck, build, `git diff --check`, and a targeted secret/payment-header scan all clean. Verdict: `NOBU_LANE_7_4D_PASS`. Evidence: `docs/proof/lane-7-4d-paid-activation/`.

## Lane 7.4E — Agent-native monitor management COMPLETE

- `LIST_ACTIVE_MONITORS`, `ENABLE_EMAIL_ALERTS`/`DISABLE_EMAIL_ALERTS`, `STOP_MONITORING` on free `/v1/agent`.
- `CHECK_MONITORING_STATUS` ownership-safe for account-owned monitors (connection credentials + hydrate + ownership); legacy non-account read preserved.
- `STOP_MONITORING` sets `monitoring_stopped_at` / `monitoring_stop_reason = user_requested` (distinct from archive); scheduler selection excludes stopped purchases; idempotent 200 `MONITORING_STOPPED` on replay.
- Reuses Lane 7.4B `authorizeAgentConnection` and Lane 7.3B `setEmailAlertPreference`; no new scheduler/notification/monitor entity; no payment changes.
- Did not edit or resubmit `#5541`; did not deploy; paid route remains private/unregistered.

**Proof:** `tests/web/agent-monitor-management.test.ts` (6 focused cases), affected agent/notification/monitoring regressions, typecheck, build, `git diff --check`. Verdict: `NOBU_LANE_7_4E_PASS`. Evidence: `docs/proof/lane-7-4e-monitor-management/`.

## Lane 7.4F — Scheduler and notification integration COMPLETE

- Durable-to-scheduler bridge: load `monitor_activations.status = 'active'` purchase blobs from AuthStore, hydrate into per-instance scheduler SQLite (including email-alert prefs + notification ledger), run existing `runScheduledMonitoringTick`, persist account-owned graphs back.
- Agent and web monitors share the same matcher, alert creation, and email workflow; stopped monitors are not fetched; disabled consent suppresses email only.
- Minimal integration fix: runner ignores outer `check_lock_until` (owned by scheduler) so locked due purchases are not permanently skipped.
- Did not edit or resubmit `#5541`; did not deploy; paid route remains private/unregistered.

**Proof:** `tests/monitoring/durable-scheduler-bridge.test.ts` (5 cases), affected monitoring/notification/activation/management regressions, typecheck, build, `git diff --check`. Verdict: `NOBU_LANE_7_4F_PASS`. Evidence: `docs/proof/lane-7-4f-scheduler-notifications/`.

## Lane 8R.0 — Official OKX seller integration and deployment preflight COMPLETE

- Replace production `not_configured` verifier with official OKX seller HTTP adapter: HMAC-authenticated `POST /api/v6/pay/x402/verify`, `POST /api/v6/pay/x402/settle`, `GET /api/v6/pay/x402/settle/status` (source: `github.com/okx/payments` OKXFacilitatorClient).
- Challenge is x402 **v2**, scheme `exact`, network `eip155:196`, USD₮0 asset, amount `990000`, `payTo` from server env only.
- Signature verification alone never activates; settle success required; pending settle returns truthful `PAYMENT_SETTLEMENT_PENDING` and reconciles via status API.
- Existing durable activation saga preserved (exactly-once). Fail closed when `OKX_API_KEY` / `OKX_SECRET_KEY` / `OKX_PASSPHRASE` / `OKX_PAY_TO` absent.
- Deploy exact commit; free `/v1/agent` unchanged; no ASP `#5541` edit/resubmit; no genuine payment.

**Proof:** `tests/payments/okx-seller-adapter.test.ts` + Lane 7.4D activation tests; typecheck; build; deploy health. Verdict: `NOBU_LANE_8R_0_PASS`. Evidence: `docs/proof/lane-8r-0-okx-seller-integration/`.

## Lane 8R.1 — Public website and interface alignment COMPLETE

- Align the complete public UseNobu website to present Nobu as an AI agent that monitors the exact product after purchase and alerts when a safely matched lower price may create an opportunity to request the difference from the retailer.
- Website + OKX.AI access paths; centralized `NEXT_PUBLIC_OKX_MARKETPLACE_URL` marketplace CTA module; five-section homepage; `/okx` customer guide; notices; purchase intake/list/detail/Action Center truth-bound copy.
- No ASP `#5541` edit; no genuine payment; website and interface only.
- Adopted sequence: `8R.0 → 8R.1 → 8R.2 → 8R → 7.4G`.

**Proof:** focused copy/component tests; homepage `/okx` notices Playwright; typecheck; build; forbidden-copy and sensitive-output scans; deploy. Verdict: `NOBU_LANE_8R_1_PASS`. Evidence: `docs/proof/lane-8r-1-public-interface/`.

## Lane 8R.2 — Active product documentation alignment COMPLETE

- Align active product documentation with the implemented product, public website, and OKX.AI dual-access positioning.
- Product overview, FAQ, OKX user guide; free and paid OpenAPI sync; align active docs to product truth (historical competition-era docs labeled historical-only); one homepage retailer-availability sentence.
- Sequence: `8R.0 → 8R.1 → 8R.2 → 8R → 7.4G`.

**Proof:** doc inventory, OpenAPI validation, consistency scans, homepage check, deploy. Verdict: `NOBU_LANE_8R_2_PASS`. Evidence: `docs/proof/lane-8r-2-documentation-alignment/`.

## Lane 8R — Accurate update and resubmission of ASP #5541 COMPLETE

- Production seller env configured; deployed-runtime 402 proved unpaid challenge (x402 v2, `990000`, eip155:196, non-null valid `payTo`).
- ASP `#5541` updated once: free service id `33561` preserved (fee `0`, `/v1/agent`); paid service created id `35958` (fee `0.99`, `/v1/agent/start-monitoring`).
- `newAgentId: null` (no second ASP). Activate once recorded; marketplace was then **under review** (`approvalStatus: 2`). Public listing URL not yet available.
- Genuine payment proof remains **Lane 7.4G**.

**Proof:** `docs/proof/lane-8r-asp-update/`. Verdict: `NOBU_LANE_8R_PASS`. **Superseded:** that "under review" state ended in the 2026-07-25 rejection — see Lane 8R.3A. Service `35958`'s `/v1/agent/start-monitoring` endpoint recorded here is still what `#5541` points at, and is now stale relative to what Nobu serves.

## Lane 8R.3 — Audit and repair OKX listing-review capability mismatch COMPLETE

- ASP `#5541` was rejected (`approvalDisplayStatus: 5`): actual service-call results did not match the capabilities stated in the service description.
- Audited: read-only ASP inspect, bounded production logs (short retention, no reviewer traffic recoverable), and reproduction of reviewer-facing calls (empty/malformed, generic natural-language, minimum documented free request, direct paid request without prepared credentials, valid unpaid paid request using a controlled payment-ready quote).
- Root cause: **endpoint usability on the paid service (`35958`)**, not listing copy — both registered descriptions were already accurate. A first call to `POST /v1/agent/start-monitoring` without a pre-existing quote/connection (the natural way to probe a service named "Nobu Monitoring Activation") returned a bare, unguided `400`/`401`.
- Repair: additive machine-readable guidance (`message`/`required_fields`/`next_action`/`documentation`) on the schema-violation and `ACTION_NOT_AUTHORIZED`/`CONNECTION_EXPIRED` failure shapes only; identical reason-agnostic text for both failure statuses (no gate weakened, no reason leaked). No listing-copy change; zero ASP updates.
- Deployed to production; reproduction cases re-verified against the fix; resubmitted via `agent activate` alone. ASP `#5541` then read `approvalDisplayStatus: 2` ("Listing under review"); both services (`33561`, `35958`) unchanged.
- Lane 7.4G remains blocked pending genuine marketplace approval.

**Proof:** `tests/payments/start-monitoring-route-guidance.test.ts` (7 focused tests); directly-affected regressions (`start-monitoring.test.ts`, `okx-seller-adapter.test.ts`) unchanged; typecheck; build; `git diff --check`; secret/payment-material scan; before/after production reproduction; before/after ASP `#5541` read-back. Verdict: `NOBU_LANE_8R_3_PASS`. Evidence: `docs/proof/lane-8r-3-review-repair/`. **Superseded:** the resubmission was rejected again — see Lane 8R.3A.

## Lane 8R.3A — Diagnose OKX A2MCP review timeout COMPLETE

- Diagnosis only: no code, deployment, ASP `#5541` update, activation, resubmission, or genuine payment. Read-only OKX CLI and read-only production probes throughout.
- ASP `#5541` rejected a second time (`approvalDisplayStatus: 5`, service-list `approvalStatus: 6`, `statusLabel: "not listed"`): *"During platform testing, we were unable to receive a response from your Agent, causing the task to time out and be stopped"*, citing both the A2A and A2MCP developer docs.
- **Primary cause: request-envelope / first-contact protocol incompatibility.** Reachability, DNS/TLS, production routing, response parseability and free action schemas all `PASS`; requests reach `dpl_AUMLVaTCynKxqPL5HMMBT5ERsq6b` and are answered in 0.5–2.5 s (worst single 8.6 s), always parseable JSON. But `GET`/`HEAD`/`PUT` → `405` with an empty body, MCP `initialize`/`tools/list` → `400`, MCP SSE open → `405`, A2A `message/send` → `400`, every natural-language envelope → `400`, and all six discovery documents → `404`. OKX's own `agent x402-check` returns `valid: false` for **both** services (`405` no-body, `400` with `{}`).
- Contributing causes: paid `402`+`PAYMENT-REQUIRED` only after a quote, never on first contact; neither service description names a wire input, action, or example request; bodyless `405` on `GET`/`HEAD`; the A2A/task channel has never routed or answered anything (0 tasks incl. terminal, 0 chat sessions, 3 inbound messages parked `invalid-json`, no daemon autostart, registration-time doctor `ready: false`) while a 60 s heartbeat advertises `onlineStatus: 1`; search-invisible while rejected; auth `pg.Pool` with no `connectionTimeoutMillis`/`statement_timeout` (the one unbounded wait).
- `NOT_PROVEN`: cold start, Groq latency (20 s × 2 ceiling), SerpApi latency (15 s × 2 ceiling), rate limiting, client disconnect, platform-side failure — first contact fails at parse in under a second, before any of those paths.
- **The official A2MCP doc could not be read from this environment** (`web3.okx.com` DNS-blocked locally; DoH resolves but TCP:443 blocked to both edge IPs while a control host returns `200`; `www.okx.ai` does not mirror it). Those contract items are `UNRESOLVED_FROM_DOCS`, not inferred.
- Observability gap recorded (not implemented): production request-log retention under one hour, and no logging of method, content type, content length, body key names, recognised `action`, or client disconnect.

**Proof:** `docs/proof/lane-8r-3a-timeout-diagnosis/`. Verdict: `NOBU_LANE_8R_3A_PASS`.

## Lane 8R.3B — A2MCP and Monitoring Pass repair CODE-COMPLETE (awaiting operator alignment)

Repair commit `1dac265`; production `dpl_HLZD27xLrSsRA6aFaaXBhFkd5wgB` with `www.usenobu.xyz` explicitly re-aliased.

- **Free `33561`** (endpoint unchanged): bodyless `POST`, `{}`, and any unrecognised envelope (`message`/`query`/`prompt`) return `200` with a `status: READY` descriptor — supported actions + required fields, recommended first action, one working example, paid-service pointer, clear `next_action`. `GET` returns the same. Pure: no Groq, SerpApi, email or Postgres; 1–3 ms server time. Malformed JSON → guided `400`; recognised action with invalid fields → existing `400` unchanged.
- **Paid `35958` → new endpoint `/v1/agent/monitoring-pass`**: one `$0.99` Nobu Monitoring Pass. Every initial call (GET or POST, body or none) returns `402` + base64 x402 v2 `PAYMENT-REQUIRED` **before any business execution**, with no quote/connection/purchase/consent required. Challenge: `x402Version: 2`, `resource{url,description,mimeType}`, `exact`, `eip155:196`, USD₮0, server-controlled `990000` + `payTo`, `maxTimeoutSeconds`, `extra.name`/`version` read from the on-chain token.
- **Exactly-once issuance** anchored on the OKX-verified settlement ref (`UNIQUE`), never a caller id. Duplicate/concurrent/lost-response replays return the same pass; only the minting call learns the one-time token. Pending settlement recorded against the sha256 digest of the replay header (never the header) and recoverable without re-charging.
- **`REDEEM_MONITORING_PASS`** (free) keeps every identity/confirmation/eligibility/consent gate; a failed validation never consumes the pass; valid redemption consumes it atomically and reuses the Lane 7.4D saga + reconciliation.
- **Reliability:** bounded Postgres connection/statement timeouts (the only unbounded path 8R.3A found); safe structured logs closing 8R.3A's observability gap — verified live.
- **Official `agent x402-check`: `valid: true`** for the new paid endpoint (with and without a body). The still-registered `/v1/agent/start-monitoring` remains `valid: false` (`HTTP 405`) — hence the operator update.
- 20 new focused tests; `tests/payments/` 47/47; typecheck and build clean. The suite's remaining 19 failures were baselined **identical at clean `32ddaa0`** (pre-existing hardcoded-date time bomb + known `store.test.ts` assertion).
- **No `agent update`, activation, resubmission, second ASP, or genuine payment performed.**

**Verdict:** `NOBU_LANE_8R_3B_READY_FOR_OPERATOR_ALIGNMENT_AND_PROOF` — not `PASS`, because `#5541` still points at the old paid endpoint. **Proof:** `docs/proof/lane-8r-3b-monitoring-pass-repair/`.

## Lane 8R.3B.1 — Suite fixture repair (pre-existing hardcoded-date and migration-list failures) COMPLETE

- Documentation/test-only lane: no production behavior, policy-window logic, payment logic, or ASP `#5541` change.
- Root cause: `tests/auth/passwordless-auth.test.ts`, `tests/db/embedded-migrations.test.ts`, `tests/matching/store.test.ts`, `tests/web/agent-preflight.test.ts`, `tests/web/purchase-lifecycle.test.ts`, and `tests/web/purchase-privacy.test.ts` pinned `purchase_date` fixtures to fixed 2026-07 dates that aged past Target's price-adjustment window (a "hardcoded-date time bomb," baselined pre-existing at clean `32ddaa0` in Lane 8R.3B), plus `tests/matching/store.test.ts`'s long-known hardcoded migration-list assertion.
- Repair: moved date fixtures to the shared relative-date helper `tests/helpers/test-dates.ts`; the two frozen migration-list assertions now derive their expected ids from `listMigrationSql()` instead of a literal list.
- All 19 previously-failing tests across the six files above now pass; no other test file's assertions changed.

**Proof:** full unit suite — **55 test files passed, 453 tests passed, 1 skipped, zero failures**. Verdict: `NOBU_LANE_8R_3B_1_PASS`. Evidence: `docs/proof/lane-8r-3b-monitoring-pass-repair/pre-existing-failures.md` (updated with resolution note).

## Lane 8R.3C — Operator alignment and genuine proof

Operator-controlled and state-changing. Exact ordered steps and placeholders: `docs/proof/lane-8r-3b-monitoring-pass-repair/operator-runbook.md`.

1. Execute the single ASP metadata update covering both services (`33561` description; `35958` name, description, `/v1/agent/monitoring-pass` endpoint, fee `0.99`).
2. Read back `#5541` and both service records immediately.
3. Record the resulting QA/review status and run no further state-changing command without explicit authorization.
4. Designated routing + official `x402-check`.
5. One genuine `$0.99` Monitoring Pass payment and replay by an eligible adult operator using their own funded wallet.
6. A legitimate OKX.ai User-role identity sends exactly `I would like to use the services of agent ID 5541`.
7. Review all evidence.

**Activation or resubmission of `#5541` is a separate, explicit decision and a separate lane.**

**Proof:** ASP + service read-back after the update; QA status; `x402-check valid: true` against the updated listing; genuine payment replay returning a real Monitoring Pass; User-role transcript with no timeout.

### Lane 8R.3C.0 — Operator preflight (read-only) COMPLETE

- Read-only preparation for Lane 8R.3C Step 1 only: no `agent update`, `agent activate`, payment, User-role registration, or resubmission executed.
- Inspected the installed official Onchain OS CLI's own `agent update --help` / `agent --help` schema to confirm exact update semantics (incremental `--service` delta, fixed agent id, no full-list replace) and that QA review is documented as triggered by `register`/`update`, not by `activate` — so the planned update is expected to re-trigger OKX marketplace QA by itself.
- Read back ASP `#5541` and both current services (`33561`, `35958`); confirmed byte-for-byte consistency with the existing documented state — no drift since Lane 8R.3B.
- Validated the proposed two-service update payload (JSON syntax and schema-field correctness against the CLI's documented keys) without submitting it to `agent update`.
- Re-verified the direct production free (`/v1/agent`, `200` descriptor) and Monitoring Pass (`/v1/agent/monitoring-pass`, `402` challenge) endpoints, plus a fresh official `x402-check` against both the repaired and the still-registered paid endpoint — all unchanged from Lane 8R.3B.
- Reported the exact state-changing effect expected from Step 1's update.

**Verdict:** `NOBU_LANE_8R_3C_0_READY_FOR_OPERATOR_DECISION`. **Proof:** `docs/proof/lane-8r-3c-0-operator-preflight/`.

### Lane 8R.3C.1 — ASP metadata alignment BLOCKED (update refused before execution)

- Attempted Lane 8R.3C Step 1: **exactly one** `agent update --agent-id 5541 --service '<8R.3C.0 payload>'`. No retry, no alternative payload, no `agent activate`, no payment, no User-role registration, no resubmission, no code change, no deploy.
- Full read-only preflight passed first at base commit `cc320d5`: clean tracked worktree on `master`; production free `/v1/agent` → `200` `status: READY` (1.12 s); production `/v1/agent/monitoring-pass` → `402` with a valid x402 v2 challenge (`exact`, `eip155:196`, USD₮0, `990000`, `maxTimeoutSeconds 300`) (0.84 s); `#5541` read back with zero drift from 8R.3C.0; payload confirmed **byte-identical** to the validated 8R.3C.0 payload (sha256 `deb1edb0…99c0d`, 1167 bytes, 2 elements, both `operation: "update"` against existing ids `33561`/`35958`, both descriptions byte-identical to the operator runbook).
- **Process disclosure:** one Onchain OS process was active — the official OKX A2A daemon, PID `19332`, `@okxweb3/a2a-node@0.1.9`, started 2026-07-23, orphaned from an exited parent shell. Identified as the **known, documented** daemon already present during Lanes 8R.3A/8R.3B/8R.3B.1 and the 8R.3C.0 preflight; escalated rather than silently interpreted; by operator decision left running and **not** killed, restarted or upgraded. Attested: exactly one instance, no child processes, no `onchainos.exe` executing.
- **Refusal:** the CLI's own **client-side preflight gate** aborted the call before any network or on-chain write — `[onchainos] checking A2A communication readiness (okx-a2a doctor)...` → `{"ok": false, "error": "A2A communication is not ready, so this operation was not executed. … Upgrade to @okxweb3/a2a-node@latest and restart the daemon on the new version …"}`. Not a backend, marketplace or payload rejection; the payload was never transmitted.
- **Read-back confirms a clean no-op:** agent id `5541`, no `newAgentId`, service ids `33561`/`35958` unchanged (total still 2, none created or deleted), `33561` unchanged in name/fee/endpoint/description, `35958` still `Nobu Monitoring Activation` at the stale `/v1/agent/start-monitoring` with its original description and fee `0.99`, and QA status still `approvalDisplayStatus 5` / `approvalStatus 6` / `not listed` — **QA not re-triggered**. Only `lastOnlineTime`/`updatedAt` moved (0–2 ms apart across three samples, still advancing with no further attempt): the known ~60 s daemon heartbeat, disclosed explicitly.
- **Blocker is the local A2A environment only.** The CLI's remedy (upgrade `@okxweb3/a2a-node` to latest, restart the daemon) is mutually exclusive with the standing "do not kill or restart the daemon" instruction and is outside this lane's authorized action, so the lane stopped rather than mutate the environment or guess around the gate. `agent update --help` documents no bypass flag; none was invented.
- Downstream immediate-proof steps (designated routing, `x402-check` against the *updated* listing, post-update QA capture) correctly **not** performed — there is no updated listing to validate.

**Verdict:** `NOBU_LANE_8R_3C_1_BLOCKED_UPDATE_REFUSED`. **Proof:** `docs/proof/lane-8r-3c-1-asp-alignment/`.

**Next action is an operator decision, not a build step.** Recorded, unexecuted options: (a) upgrade `@okxweb3/a2a-node` and restart the daemon, then retry the single update — briefly drops `#5541`'s A2A availability; (b) `okx-a2a doctor --fix` (same upgrade/restart); (c) establish whether a supported CLI path updates identity/services without the A2A readiness gate — **not established**.

### Lane 8R.3C.2 — A2A readiness repair and single ASP update retry BLOCKED

- Resumed from exact commit `c3f2ccac17f457733e2a4c1f4bc3981ba2a4e4ee` after the operator manually repaired the Windows CLI. Clean `master`; `.local\bin\onchainos.exe` resolved first at `4.4.0`; the old `4.2.4` binary remained untouched in second PATH position.
- Pre-mutation read-back confirmed ASP `#5541`, services `33561`/`35958`, and the production endpoints unchanged. `/v1/agent` returned `200 READY`; `/v1/agent/monitoring-pass` returned the expected x402 v2 `402`.
- Inspected `@okxweb3/a2a-node@0.1.9`, doctor help, and the one known old daemon (PID `19332`). Official doctor identified only two blocking repairs: upgrade to stable `0.1.10` and bind the detected `codex` provider; autostart was optional.
- Stopped only PID `19332`, upgraded the package once to `0.1.10`, and restarted exactly one daemon with the existing Nobu configuration and provider `codex` (PID `27124`). Final official doctor: `ready: true`, zero blocking failures, 8 passes, zero warnings/failures, one untouched optional autostart item. No old-version daemon remained; ASP `#5541` resolved with `onlineStatus: 1`; no QA-governed field changed.
- After explicit operator confirmation, invoked the exact Lane 8R.3C.0 payload once (1167 bytes; sha256 `deb1edb0…99c0d`). Onchain OS `4.4.0` refused it during local Windows `--service` JSON parsing: `key must be a string at line 1 column 3`. No retry, alternative payload, or alteration was attempted.
- Immediate read-back confirmed no partial state: agent `5541`; exactly services `33561`/`35958`; all names, descriptions, fees, endpoints, and QA fields unchanged; QA not retriggered. `35958` remains `Nobu Monitoring Activation`, fee `0.99`, at `/v1/agent/start-monitoring`.
- Official read-only `x402-check` against `/v1/agent/monitoring-pass` returned `valid: true` (`x402Version 2`, `exact`, `eip155:196`, `990000` minimal units).
- No activation, resubmission, payment, User-role registration, production-code change, deployment, or second update occurred.

**Verdict:** `NOBU_LANE_8R_3C_2_BLOCKED_UPDATE_REFUSED`. **Proof:** `docs/proof/lane-8r-3c-2-a2a-repair-and-alignment/`.

**Exact next lane/action:** Lane 8R.3C.2 remains blocked and its update authorization is spent. A new operator-controlled lane must determine and read-only validate the documented Windows argument-transport form accepted by Onchain OS `4.4.0`, then obtain explicit authorization before any future ASP write.

### Lane 8R.3C.3 — Windows `--service` argument transport proof BLOCKED

- Strictly read-only lane from exact commit `0fecf578a125b3ad843fa539a36ad2d3c9c4fccf`; clean `master`, worktree, and index.
- Selected executable `C:\Users\dtwof\.local\bin\onchainos.exe`, version `4.4.0`; preflight stable/current `4.4.0`, integrity `ok`, no CLI update. Instruction-bundle maintenance was not run because the lane was read-only.
- Official A2A doctor passed read-only outside the restricted workspace sandbox: `ready: true`, zero blocking failures, `0.1.10`, existing daemon PID `27124`, identity refresh unchanged. The first sandboxed doctor's `EPERM`/read-only-database failures were environmental only and triggered no repair.
- Pre/post ASP reads matched: agent `5541`, exactly services `33561`/`35958`, all names/descriptions/fees/endpoints, `onlineStatus: 1`, and QA `approvalDisplayStatus 5` / `approvalStatus 6` / `not listed` unchanged.
- Installed `4.4.0` help says `validate-listing` is pure-local/no-network and its `--service` uses the same JSON element shape as create/update. Read-only binary strings contain the `PARSE`, `failed to parse --service as JSON array`, and `key must be a string` diagnostics.
- Loaded the exact Lane 8R.3C.0 payload inside Node. Immediately before spawn: 1167 UTF-8 bytes, sha256 `deb1edb0…99c0d`, two entries (`update:33561`, `update:35958`), both descriptions byte-identical to the operator runbook.
- Invoked `agent validate-listing` exactly once via Node `child_process.spawnSync`, `shell: false`, explicit ten-element argument array. Payload appeared once as argument index 9 and was never interpolated through PowerShell.
- Validation exit code `0`, stderr empty. Parser result failed: stdout returned `pass: false` with blocking `field: service`, `code: PARSE`, `--service is not a valid JSON array of service objects.` The earlier `key must be a string` error did not recur, but the required no-`PARSE` criterion did not pass.
- Stopped immediately: no second validation, no alternative transport, no payload alteration, no `agent update`, no activation, payment, User registration, A2A mutation, deployment, or resubmission.

**Verdict:** `NOBU_LANE_8R_3C_3_BLOCKED_ARGUMENT_TRANSPORT`. **Proof:** `docs/proof/lane-8r-3c-3-windows-argument-transport/`.

**Exact next lane/action:** A new explicitly authorized read-only operator lane must use the official Onchain OS `4.4.0` implementation to distinguish Windows argv corruption from validator service-schema rejection. It must not alter the canonical payload or run an ASP write. No update authorization exists.

### Lane 8R.3C.4 — Onchain OS 4.4.0 payload-schema repair proof COMPLETE

- Strictly read-only lane from exact commit `bda75526917929d150cb184ddf9eaaf8fd75859d`; clean `master`, tracked worktree and index.
- Selected `C:\Users\dtwof\.local\bin\onchainos.exe` reported `4.4.0`; preflight stable/current `4.4.0`, integrity `ok`, `updated: false`. Stale instruction-bundle maintenance was not run because the lane was read-only.
- Official A2A doctor remained ready: zero blockers, package `0.1.10`, existing daemon PID `27124`, identity refresh unchanged, no fixes applied.
- Official `okx/onchainos-skills` tag `v4.4.0` at commit `782b5a05d9b0af797383009b0e5f0d4022b010e5` was inspected at `identity/models.rs`, `identity/args.rs`, `identity/validate.rs`, and `identity/utils.rs`.
- Source diagnosis confirmed: `AgentService.id` is `Option<String>`; create/update/validate use the same model; any serde/model failure is surfaced as `service/PARSE`; update operation requires an id; descriptions require at least separate capability and user-input lines, with a delivery line recommended.
- Built exactly one corrected candidate preserving `operation: "update"`, ids `"33561"`/`"35958"`, A2MCP types, fees `"0"`/`"0.99"`, intended endpoints and intended capabilities. Both descriptions have three non-empty truthful sections without URLs, test markers or outcome promises.
- Local invariants passed before CLI invocation: JSON parse, exactly two elements, string ids, required keys and locked values. Exact serialization: 1162 UTF-8 bytes, sha256 `4926b9d2afb790a71d45b32ef0c81ae9114666bf9c9da40ea1fa1b64b9215fa9`.
- Invoked `agent validate-listing` exactly once using Node `child_process.spawnSync`, `shell: false`, explicit ten-element argument array. The payload appeared once at index 9 and was checked against the recorded bytes/hash immediately before spawn.
- Validation exit `0`, stderr empty, `pass: true`, zero findings, no `service/PARSE`, and no `key must be a string`. No second validation or alternative transport method ran.
- Immediate ASP readback remained unchanged: agent `5541`, exactly services `33561`/`35958`, all registered names/descriptions/fees/endpoints, online `1`, QA `approvalDisplayStatus 5` / `approvalStatus 6` / `not listed`; only heartbeat timestamps advanced.
- No `agent update`, activation, payment, User registration, A2A package/daemon change, deployment or resubmission occurred.

**Verdict:** `NOBU_LANE_8R_3C_4_READY_FOR_OPERATOR_DECISION`. **Proof:** `docs/proof/lane-8r-3c-4-payload-schema-repair/`.

**Exact next lane/action:** Lane 8R.3C.5 — a separately authorized single corrected ASP metadata update and immediate read-only proof using the exact Lane 8R.3C.4 candidate unchanged. No ASP write is authorized by Lane 8R.3C.4.

### Lane 8R.3C.5 — Single corrected ASP metadata update BLOCKED ON QA STATE

- Began at exact commit `60a27b6ca82ca9ad3ab51504d6c98b5d715c3597` with clean tracked worktree and index; selected `C:\Users\dtwof\.local\bin\onchainos.exe` version `4.4.0`.
- Completed the required instruction-bundle preflight maintenance to `4.4.0`. Official A2A doctor remained ready with zero blockers, package `0.1.10`, exactly one known daemon PID `27124`, and unchanged identity refresh; no A2A fix or mutation ran.
- Pre-update production proof passed: `/v1/agent` returned `200 READY`; `/v1/agent/monitoring-pass` returned `402`; official x402 validation returned `valid: true`.
- After the mandatory update diff card and explicit confirmation `1`, invoked exactly one update using the unchanged Lane 8R.3C.4 payload loaded directly from its artifact, guarded immediately before spawn at 1162 UTF-8 bytes / sha256 `4926b9d2afb790a71d45b32ef0c81ae9114666bf9c9da40ea1fa1b64b9215fa9`.
- Transport was Node `child_process.spawnSync`, `shell: false`, explicit six-element argument array. Exit `0`; `newAgentId: null`; transaction `0xea8dbdaf7d2f821e0638ff1f5da809d571619016ad36adf3872392a5a3cec45b`.
- Immediate readback proved a complete expected write with no partial state or identity drift: agent `5541`; exactly services `33561`/`35958`; `33561` preserved as free `Nobu Purchase Setup` at `/v1/agent` with the corrected multiline description; `35958` became `Nobu Monitoring Pass`, fee `0.99`, endpoint `/v1/agent/monitoring-pass`, with the exact corrected multiline description. No service was created or deleted.
- Designated routing resolved online with both corrected services. Both official x402 checks (no body and `{}`) returned `valid: true`, x402 v2, `exact`, `eip155:196`, `990000`.
- **QA did not retrigger:** the immediate readback remained `approvalDisplayStatus 5`, `approvalStatus 6`, `Listing rejected` / `not listed`, with the prior timeout remark. The required pending-QA outcome therefore did not occur.
- No retry, second update, alternate payload, activation, resubmission, payment, User registration, A2A mutation, deployment, or production-code change occurred.

**Verdict:** `NOBU_LANE_8R_3C_5_BLOCKED_QA_NOT_RETRIGGERED`. **Proof:** `docs/proof/lane-8r-3c-5-asp-metadata-update/`.

**Exact next lane/action:** operator decision on the unchanged rejected/not-listed QA state. No further update, activation, resubmission, payment, User registration, A2A change, deployment, or production-code change is authorized.

### Lane 8R.3C.6 — Free A2MCP input-required validation repair COMPLETE

- Started from exact commit `3021f1a033408ccd5157153b81d7fcee1ed79e19`; changed only the free `/v1/agent` validation path, its pure response builder, focused tests, free OpenAPI, and proof/current-state documentation.
- Empty GET, bodyless POST, `{}`, and other requests with no supported `action` return HTTP `400` with `status: "input_required"`, `fields: ["action"]`, and `requiredArgs: ["action"]`.
- The response retains the truthful supported-action list and each action's required fields, allowing the official Onchain OS service-input flow to continue.
- Requests containing a supported action bypass this response and preserve the existing dispatcher behavior; valid `UNDERSTAND_PURCHASE` remains successful.
- The free service remains free: no `402`, payment challenge, or payment requirement was added.
- No paid-route file changed; the Monitoring Pass remains x402 v2 `402` and official-checker `valid: true` with and without `{}`.
- Deployed code commit `7a4ef1e` as Vercel deployment `B4DsuLSbWcR3S2b23XQv3nknXiPQ`; explicitly re-aliased `www.usenobu.xyz` and repeated all required checks in Production.
- No ASP update, activation, resubmission, payment, User registration, A2A change, or production-data mutation occurred.

**Proof:** focused validation 5/5; focused Monitoring Pass 20/20; full suite 56 files / 458 tests passed / 1 skipped; typecheck; production build; local and Production direct probes; official Onchain OS 4.4.0 `x402-check` (`inputRequired: true` on the free endpoint, `valid: true` on the paid endpoint). Verdict: `NOBU_LANE_8R_3C_6_PASS`. Evidence: `docs/proof/lane-8r-3c-6-free-input-validation/`.

**Exact next lane/action:** operator decision on the unchanged rejected/not-listed QA state. No additional ASP update, activation, resubmission, payment, User registration, A2A change, deployment, or production-code change is authorized.

### Marketplace journey continuity repair COMPLETE

- Proved visible-message ownership: Nobu owns its wire introduction, service guidance, paid deliverable and continuation fields; installed Onchain OS `4.4.0` owns `Endpoint returned 200 — no payment required` and `[Job Completed]` / `[x402 Job Completed]` wrappers. Platform strings were not changed.
- Free service `33561` introduces Nobu first, explicitly says Purchase Setup is free and x402 does not apply, and keeps its `400 input_required` first-contact contract (never `402`).
- Paid service `35958` explains before payment that `$0.99` buys a Monitoring Pass only. Successful replay returns `MONITORING_PASS_ISSUED`, non-active/incomplete journey flags, `UNDERSTAND_PURCHASE`, service `33561`, required purchase input and continuation guidance.
- Provider-controlled setup steps expose `completed_step`, `monitoring_active`, `journey_complete`, `next_action`, `required_user_input` and `guidance`; only successful pass redemption returns journey status `MONITORING_ACTIVE`.
- No pass token is exposed or accepted. Pass ids use full UUID entropy; authorization, quote ownership, fingerprint, eligibility, consent, atomic redemption, exactly-once issuance/settlement and activation remain enforced.
- Deployed `dpl_WJjvs2hQTfUzVSZqfXAKTrnUahvU`; canonical alias explicitly updated. One free Production probe and one unpaid paid challenge probe passed. No task, payment, paid replay, pass issuance, redemption or ASP mutation ran.

**Proof:** focused free route 5/5; focused Monitoring Pass/redemption 20/20; typecheck; limited secret scan; Production `400` free probe and x402 v2 `402` unpaid probe. Verdict: `NOBU_MARKETPLACE_JOURNEY_CONTINUITY_PASS`. Evidence: `docs/proof/marketplace-journey-continuity/`.

### Monitoring Pass settlement reconciliation repair COMPLETE

- Live marketplace settlement released `0.99` USDT but Nobu remained at `PAYMENT_SETTLEMENT_PENDING` with no Monitoring Pass because convergence required replaying the same `PAYMENT-SIGNATURE` header; marketplace job completion does not replay.
- Durable pending row already stores `authorization_digest` (sha256 only) and opaque `settlement_ref` (pending tx). Repair adds AuthStore listing of verifying / settled-without-pass rows and `reconcilePendingPassSettlements`, which polls official `settle/status` from the stored ref alone, marks settled, and issues exactly one pass (`UNIQUE settlement_ref`).
- Authenticated internal recovery: `POST /v1/owner/pass-settlement-reconcile` (Bearer `OWNER_OPS_SECRET` or `CRON_SECRET`). No second payment challenge; retries and concurrent runs cannot duplicate.
- Issued response remains `MONITORING_PASS_ISSUED`, `monitoring_active: false`, continuation `UNDERSTAND_PURCHASE` / service `33561`. Secrets and pass tokens never logged or returned.
- No live payment, signed replay, task, ASP edit, activation, or resubmission in this lane.

**Proof:** `tests/payments/monitoring-pass.test.ts` 22/22 (incl. later-confirm + no-duplicate reconcile); related payment tests 27/27; typecheck; limited secret scan. Verdict: `NOBU_MONITORING_PASS_SETTLEMENT_RECONCILE_PASS`. Evidence: `docs/proof/monitoring-pass-settlement-reconcile/`.

**Exact safe operator recovery after deploy:** one `POST /v1/owner/pass-settlement-reconcile` with Bearer cron/owner secret. Do not pay again or replay a signed payment header. Then continue free `UNDERSTAND_PURCHASE`.

### Live Monitoring Pass recovery COMPLETE

- Deployed clean `fc81bc0` to Production; canonical `www.usenobu.xyz` explicitly aliased to redeploy `dpl_biFwq6Un5bW9hKQfKQRsmB77YVFu`.
- Pre-recovery: one durable `verifying` payment with settlement ref; zero passes.
- First reconcile: `ok: true`, `scanned: 1`, `issued: 1`, pass `pass_8dd13c79ce1842aa89f91609527764f4`.
- Second reconcile: `scanned: 0`, `issued: 0` — no duplicate pass or charge.
- Post-recovery DB: payment `settled`, exactly one `issued` pass.
- No task, payment, signed replay, ASP edit, activation, or resubmission.

**Proof:** Production health + dual reconcile + durable readback. Verdict: `NOBU_LIVE_MONITORING_PASS_RECOVERY_PASS`. Evidence: `docs/proof/live-monitoring-pass-recovery/`.

**Exact next customer-facing step:** free service `33561` `UNDERSTAND_PURCHASE` with pass id `pass_8dd13c79ce1842aa89f91609527764f4`. Do not pay again.

### Pass handoff and sequential journey COMPLETE

- Free `RESOLVE_MONITORING_PASS` + durable `pass_continuation_id` for post-pending handoff; historical pass backfill; OKX-consumable top-level `fields`/`requiredArgs`.
- Sequential Purchase Setup guidance: purchase details before email/consent.
- Deployed `dpl_GgroyZbmnevwrTngsG3qjfFLKmHL`; Production resolve of recovered pass issued/inactive.

**Proof:** focused tests 39/39; typecheck; Production health/free/paid/resolve. Verdict: `NOBU_PASS_HANDOFF_AND_SEQUENTIAL_JOURNEY_PASS`. Evidence: `docs/proof/pass-handoff-sequential-journey/`.

## Lane 7.4G — Live marketplace end-to-end proof

- Prove: agent request → product confirmation → email verification → consent → genuine `$0.99` payment → monitor activation → scheduled monitoring → genuine eligible email alert → status retrieval → duplicate suppression.

**Proof:** end-to-end evidence bundle covering every step above with no fake payments, users, revenue, transactions, or alerts.

Then **Lane 9 — Product / release closeout** (defined later in this document) after the applicable 7.4 proof.

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
- Primary production URL: `https://www.usenobu.xyz` (public, no SSO).
- Product name remains Nobu; deployment identity is UseNobu.
- No OKX registration in this lane.

**Proof:** case-insensitive prior-brand repository scan empty; production health and A2MCP checks on www.usenobu.xyz; proof under `docs/proof/usenobu-production/`.

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
- Listing path for Lane 8: `https://www.usenobu.xyz/v1/agent`.

**Proof:** AI unit tests, e2e intake, production browser NL flow, agent API checks under `docs/proof/nobu-ai-agent/`.

## Lane 7.5E.2 — Migrate AI extraction to Groq + activate live provider ✅ COMPLETE

- Replace unactivated xAI path with **Groq** (`GROQ_API_KEY`, default model `openai/gpt-oss-20b`).
- Strict JSON schema extraction; deterministic fallback retained.
- Health: `groq_configured` boolean + model name only.
- Live production: `provider: "groq"` proven.

**Proof:** `docs/proof/nobu-ai-agent/live-groq-provider/` — `NOBU_LANE_7_5E_2_PASS`.

## Lane 8 — OKX ASP registration and live listing (**HISTORICAL — superseded**)

> **Superseded.** Every "pending review" / `approvalStatus: 2` statement in this
> section is historical. ASP `#5541` is now **rejected / not listed**
> (`approvalDisplayStatus: 5`) after the 2026-07-25 platform-test timeout. The
> live thread is Lane 8R.3A (diagnosis) → Lane 8R.3B (repair, code-complete and
> Production-proven) → Lane 8R.3C (operator alignment and proof).

**Lane 7.4C.1 roadmap note:** this lane's free-listing review runs independently of 7.4 development — 7.4D.0 through 7.4F proceed without waiting for it to resolve and without editing/resubmitting `#5541`. The next `#5541` edit is **Lane 8R** (after 7.4F, before 7.4G), which accurately reflects whatever is genuinely built by then; it is not this lane reopened.

- Register free A2MCP ASP using **`https://www.usenobu.xyz/v1/agent`**.
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

## Lane 9 — Product / release closeout

- Short product demo of the live website and agent flow.
- Realistic purchase and observed-price path.
- Clearly identify third-party price source and Target final verification.
- Archive release evidence (deploy commit, health, free agent smoke).

**Proof:** demo artifact, production health, free agent smoke, ASP listing consistent with live behavior.

## Lane 10 — Optional post-listing enhancements

Only after Lane 8R / 7.4G closeout where relevant:

- receipt image parsing improvements;
- additional alert channels;
- more live Target product coverage;
- capacity dashboard.

No second retailer until the Target MVP is closed and a dedicated retailer-integration lane is approved.
