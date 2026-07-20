# Lane 7.4C — Free agent-native discovery, confirmation, consent and monitoring preflight

**Verdict:** `NOBU_LANE_7_4C_PASS`, repaired by **Lane 7.4C.1** — **`NOBU_LANE_7_4C_1_PASS`**

## Lane 7.4C.1 repair (2026-07-20)

The original Lane 7.4C pass below is **corrected**: `PREFLIGHT_MONITORING` did
**not** activate monitoring, contrary to what "What shipped" originally
claimed here. It called `confirmAndPersistLockedFingerprint`
(`src/matching/store.ts`), which also sets `purchases.status =
'MONITORING_ACTIVE'` — meaning a free, payment-free agent action could start
real monitoring. Fixed by:

- Adding `confirmAndPersistLockedFingerprintPending` (`src/matching/store.ts`)
  — identical fingerprint-lock/persist logic (both functions now share one
  internal `persistConfirmedFingerprint` helper), but the purchase is left in
  a new truthful, scheduler-ineligible status,
  `MONITORING_PAYMENT_READY_STATUS` (`"MONITORING_PAYMENT_READY"`), never
  `MONITORING_ACTIVE`. The consumer web confirmation flow's
  `confirmAndPersistLockedFingerprint` is byte-for-byte unchanged and still
  activates monitoring immediately — verified by a direct regression test.
- No scheduler code changed: `selectActivePurchases`
  (`src/monitoring/selection.ts`) and `loadScheduleRows`
  (`src/monitoring/scheduler.ts`) already select strictly on `status ===
  "MONITORING_ACTIVE"`, so the new status is automatically excluded.
- Failure-recoverable preflight: after resolving a purchase id (fresh
  reservation or an already-`materialized` session), the purchase row's
  existence is always checked and inserted if missing — recovering a prior
  attempt that crashed between session reservation and purchase insertion,
  using the reserved id, never a new one. A concurrent recovery race on the
  same id is caught (primary-key conflict) and re-read, never duplicated.
- Quote-issuance failure with no recoverable existing active quote now
  returns a graceful `{ error: "quote_issuance_failed" }` (HTTP 503) instead
  of throwing; because the fingerprint step never sets `MONITORING_ACTIVE`,
  a quote failure structurally can never leave an active purchase either way.
- Retries and real concurrent calls (`Promise.all`-verified) still produce
  exactly one purchase and one active quote; an existing valid quote is
  reused.
- Corrected this document (below) and
  `docs/nobu-okx-agent-native-paid-monitoring-architecture.md` /
  `docs/nobu-build-order.md` / `docs/nobu-current-state.md`, all of which
  previously claimed or implied `PREFLIGHT_MONITORING` activates monitoring.
- **Roadmap correction:** removed the requirement to wait for ASP `#5541`'s
  current review before continuing 7.4 development. Adopted order: `7.4C.1 →
  7.4D.0 official OKX topology re-check → 7.4D → 7.4E → 7.4F → Lane 8R
  accurate edit/resubmit of #5541 → 7.4G → Lane 9`. `#5541` is not edited or
  resubmitted during 7.4D.0–7.4F.

**Lane 7.4C.1 proof:** `tests/web/agent-preflight.test.ts` — 15/15 passed (3
new: preflight creates a fingerprint and quote but never `MONITORING_ACTIVE`
and the scheduler cannot select it; recovers on retry after a simulated crash
between reservation and insertion; quote-issuance failure never activates
monitoring and creates no duplicate — plus the existing 12, including
retries/concurrency and a new direct check that the unchanged web
confirmation flow still activates monitoring normally), typecheck, build,
`git diff --check` clean. Pre-existing, unrelated failure
(`tests/matching/store.test.ts`, migration `0007_email_alerts` naming,
confirmed present before this lane via `git stash`) left untouched.

## What shipped (Lane 7.4C, corrected)

- Durable `discovery_sessions` / `monitoring_enrollment_quotes` tables in the
  same durable AuthStore as `auth_accounts` / `agent_connections`
  (`src/auth/durable-schema.ts`) — PostgreSQL production, SQLite tests/local,
  never per-instance storage or the browser cookie snapshot.
- `DISCOVER_PRODUCT` — no connection required. Accepts validated structured
  purchase fields (mirrors the existing `UNDERSTAND_PURCHASE`
  `extracted_purchase` contract; **never** accepts or stores raw purchase
  text). Reuses the existing Target discovery client
  (`src/web/live-discovery.ts#discoverLiveTargetCandidates`) and the bounded,
  Target-Plus-excluding multi-candidate evaluator
  (`src/matching/discovery-candidates.ts#evaluateUncertainProductDiscovery`,
  max 5 candidates). Stores a validated structured snapshot (price/date/
  channel/region/product clues — never raw text) plus the bounded candidate
  snapshot on a 30-minute-TTL `discovery_sessions` row. Creates no durable
  owned purchase and exposes no private monitoring state.
- `CONFIRM_PRODUCT` — no connection required. Reloads the durable candidate
  snapshot, enforces the 30-minute freshness bound, and reuses
  `src/matching/confirm.ts#confirmProductMatch` (a pure function — no DB
  writes) to lock a fingerprint **against the discovery session only**.
  Rejects stale/expired sessions, tampered/unknown candidate ids, and
  non-Target/Target-Plus/weak/title-only candidates — identical revalidation
  rules to the consumer web confirmation flow
  (`src/web/purchase-service.ts#confirmPurchaseCandidate`). Still creates no
  purchase row.
- `PREFLIGHT_MONITORING` — requires a Lane 7.4B verified connection
  (`connection_id` + `connection_token`, authorized via the shared
  `authorizeAgentConnection` helper) and both `monitoring_consent` and
  `email_alert_consent` explicitly `true`. On pass: atomically reserves and
  materializes exactly one account-owned `purchases` row from the confirmed
  session's structured snapshot, then attaches the locked fingerprint
  (Lane 7.4C.1: via
  `src/matching/store.ts#confirmAndPersistLockedFingerprintPending` — **never
  activates monitoring**; leaves `purchases.status =
  "MONITORING_PAYMENT_READY"`) **only after** the existing deterministic
  Target eligibility/window check
  (`src/policy/evaluate-target-policy.ts#evaluateTargetPolicy`) passes, then
  mints an expiring `$0.99 USD` `monitoring_enrollment_quotes` row and
  returns `MONITORING_PAYMENT_READY`. Settlement asset/network are left
  `NULL`, undecided until Lane 7.4D. Only Lane 7.4D's `START_MONITORING`,
  after verified payment, may transition a purchase to `MONITORING_ACTIVE`.
  Ineligible purchases (unsupported region/channel, Target Plus, window
  expired, policy stale) still get a durable purchase row (materialized
  before the eligibility check per the required ordering) but **never** a
  fingerprint, **never** `MONITORING_PAYMENT_READY_STATUS`, **never**
  `MONITORING_ACTIVE`, and **never** a quote — the existing locked policy
  status is returned as-is.
- **Idempotency:** an atomic `discovery_sessions` compare-and-set
  (`status='confirmed' → materialized_purchase_id=X`, first caller wins) plus
  a partial-unique index (`monitoring_enrollment_quotes(purchase_id) WHERE
  status='issued'`) guarantee retries and concurrent calls for the same
  connection/session never create a second purchase or a second active
  quote — verified directly under real concurrency (`Promise.all`).
- Wired additively into the existing bounded `/v1/agent` dispatcher
  (`src/ai/agent-service.ts`, `src/ai/schemas.ts`). The three original live
  actions and the three Lane 7.4B agent-connection actions are unchanged.

## Not built (hard locks)

Payments/x402, `START_MONITORING`, `payment_attempts`/`monitor_activations`
ledgers, monitor management (`LIST_ACTIVE_MONITORS` etc.), scheduler
changes, production deployment, and OKX topology research were **not**
touched. ASP #5541 was not deployed, edited, or resubmitted.

## Proof

| Check | Result |
|---|---|
| Discovery without identity creates no purchase | `tests/web/agent-preflight.test.ts` — pass |
| Bounded Target-only candidates; Target Plus excluded (7 offers → ≤5, exclusions absent) | same file — pass |
| Confirmation rejects stale/tampered/weak/title-only/non-Target/Target-Plus candidates | same file — pass |
| Confirmation creates only a session-bound fingerprint (no purchase row) | same file — pass |
| Preflight rejects invalid connection and missing consent | same file — pass |
| Unsupported (Alaska)/ambiguous (unconfirmed)/expired sessions create no quote | same file — pass |
| **(7.4C.1)** Preflight creates a fingerprint and quote but never `MONITORING_ACTIVE`, and the scheduler's own selection function cannot select it | same file — pass |
| **(7.4C.1)** Recovers on retry when purchase insertion fails after a successful session reservation (crash simulation) | same file — pass |
| **(7.4C.1)** Quote issuance failure never activates monitoring and creates no duplicate | same file — pass |
| Retries + real concurrency (`Promise.all`) create no duplicate purchase/quote | same file — pass |
| **(7.4C.1)** Existing web confirmation flow still activates monitoring normally (unchanged) | same file — pass |
| Lane 7.4B agent-connection actions unchanged (begin/verify/revoke) | same file — pass |
| Original three live agent actions unchanged (invalid action, `CHECK_CONFIRMED_PURCHASE`) | same file — pass |
| Full agent-service dispatch: DISCOVER → CONFIRM → PREFLIGHT over `/v1/agent` | same file — pass |
| `tests/web/agent-preflight.test.ts` | **15/15 passed** |
| Directly affected regressions (auth, ai, a2mcp, matching, monitoring, policy, web, notifications) | **293/294 passed**, 1 skipped |
| typecheck (`tsc --noEmit`) | pass |
| build (`next build`) | pass |
| `git diff --check` | clean (no whitespace errors; CRLF conversion notices only) |
| Sensitive-output scan | pass — no `console.*` calls in the new/changed service code; `DISCOVER_PRODUCT` never accepts or stores raw purchase text; no email/token/code values appear in this proof bundle |

Pre-existing, unrelated failure confirmed present on `HEAD` before both this
lane's and Lane 7.4C.1's changes (via `git stash`, same class already
documented in the Lane 7.4B proof): `tests/matching/store.test.ts` —
migration `0007_email_alerts` naming assertion, untouched by either lane, not
part of either lane's proof surface.

## Changed files

**Lane 7.4C (original):**

- `src/auth/durable-schema.ts` — `discovery_sessions`, `monitoring_enrollment_quotes` tables (+ partial-unique active-quote index)
- `src/auth/auth-store.ts` — store interface + Postgres/SQLite adapter methods for both new tables
- `src/web/agent-preflight-service.ts` — new service module: `discoverProductForAgent`, `confirmProductForAgent`, `preflightMonitoringForAgent`
- `src/web/purchase-service.ts` — exported `PENDING_DISCOVERY_URL` and `purchaseHasExactIdentity` for reuse (no behavior change)
- `src/ai/schemas.ts` — `DiscoveryPurchaseFieldsSchema` + three new `AgentRequestSchema` variants
- `src/ai/agent-service.ts` — dispatch wiring, `AgentServiceDeps`/`AgentServiceResult` extended, `offersOverride` forwarded for tests
- `openapi/nobu-agent-native-paid-monitoring-proposed.openapi.yaml` — marks the three newly implemented actions/schemas, adds `CANDIDATE_NOT_CONFIRMABLE`/`PRODUCT_CONFIRMED` and the existing locked policy statuses to `ContinuationStatus`, keeps unimplemented actions clearly proposed
- `docs/nobu-okx-agent-native-paid-monitoring-architecture.md` — §3.3 updated for the implemented `structured_snapshot_json` field and materialization ordering; §12 build order marks Lane 7.4B/7.4C complete
- `tests/web/agent-preflight.test.ts` — new focused test suite (12 tests)

**Lane 7.4C.1 (repair):**

- `src/matching/store.ts` — extracted shared `persistConfirmedFingerprint` helper; `confirmAndPersistLockedFingerprint` unchanged behavior (still `MONITORING_ACTIVE`); added `confirmAndPersistLockedFingerprintPending` + exported `MONITORING_PAYMENT_READY_STATUS`
- `src/web/agent-preflight-service.ts` — uses the pending fingerprint-lock path; unified purchase-existence check with insert-if-missing recovery; quote-issuance failure returns a graceful error instead of throwing
- `src/ai/agent-service.ts` — dispatch handles the new `quote_issuance_failed` error shape
- `tests/web/agent-preflight.test.ts` — 3 new tests, 1 existing test extended with status/scheduler assertions (12 → 15 total)
- `docs/nobu-okx-agent-native-paid-monitoring-architecture.md`, `docs/nobu-build-order.md`, `docs/nobu-current-state.md` — corrected all claims that `PREFLIGHT_MONITORING` activates monitoring; added Lane 7.4D.0 and Lane 8R; removed the Lane-8-blocks-7.4D gate
- `docs/proof/lane-7-4c-agent-preflight/README.md` — this file, corrected

## Hard locks preserved

- No payment/x402/`START_MONITORING`/activation-ledger/monitor-management/scheduler code added
- ASP #5541 not deployed, edited, or resubmitted
- No raw purchase text, email, code, or token logged or placed in this proof bundle
- Target-only MVP, fail-closed matching/policy, no refund guarantees — untouched
- `PREFLIGHT_MONITORING` never activates monitoring (Lane 7.4C.1) — only Lane 7.4D's `START_MONITORING`, after verified payment, may
