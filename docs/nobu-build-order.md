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

## Lane 8R — Accurate update and resubmission of ASP #5541

- First point where `#5541` is edited or resubmitted after free registration — only after 8R.0–8R.2 are proven.
- **Production OKX seller credentials must be configured before registration proof** (verify/settle/status fail closed without them).
- Existing **free** service remains on ASP `#5541`.
- New paid **$0.99** activation service is added under the **same** ASP (no second ASP).
- Listing copy must match the final website and documentation.
- Genuine payment proof remains **Lane 7.4G** (not this lane).
- No fake or aspirational claims; paid-service description must match real, tested activation behavior.

**Proof:** resubmission record (fields changed, before/after), consistency check against the actually-deployed paid behavior.

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

**Lane 7.4C.1 roadmap note:** this lane's free-listing review runs independently of 7.4 development — 7.4D.0 through 7.4F proceed without waiting for it to resolve and without editing/resubmitting `#5541`. The next `#5541` edit is **Lane 8R** (after 7.4F, before 7.4G), which accurately reflects whatever is genuinely built by then; it is not this lane reopened.

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
