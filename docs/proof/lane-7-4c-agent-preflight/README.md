# Lane 7.4C — Free agent-native discovery, confirmation, consent and monitoring preflight

**Verdict:** `NOBU_LANE_7_4C_PASS`

## What shipped

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
  session's structured snapshot, attaches the locked fingerprint and
  activates monitoring (reusing
  `src/matching/store.ts#confirmAndPersistLockedFingerprint`) **only after**
  the existing deterministic Target eligibility/window check
  (`src/policy/evaluate-target-policy.ts#evaluateTargetPolicy`) passes, then
  mints an expiring `$0.99 USD` `monitoring_enrollment_quotes` row and
  returns `MONITORING_PAYMENT_READY`. Settlement asset/network are left
  `NULL`, undecided until Lane 7.4D. Ineligible purchases (unsupported
  region/channel, Target Plus, window expired, policy stale) still get a
  durable purchase row (materialized before the eligibility check per the
  required ordering) but **never** a fingerprint, **never**
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
| Supported preflight creates exactly one owned purchase and one quote | same file — pass |
| Retries + real concurrency (`Promise.all`) create no duplicate purchase/quote | same file — pass |
| Lane 7.4B agent-connection actions unchanged (begin/verify/revoke) | same file — pass |
| Original three live agent actions unchanged (invalid action, `CHECK_CONFIRMED_PURCHASE`) | same file — pass |
| Full agent-service dispatch: DISCOVER → CONFIRM → PREFLIGHT over `/v1/agent` | same file — pass |
| `tests/web/agent-preflight.test.ts` | **12/12 passed** |
| Directly affected regressions (auth, ai, a2mcp, matching, policy, web, notifications) | **283/284 passed**, 1 skipped |
| typecheck (`tsc --noEmit`) | pass |
| build (`next build`) | pass |
| `git diff --check` | clean (CRLF conversion notices only, no whitespace errors) |
| Sensitive-output scan | pass — no `console.*` calls in the new service; `DISCOVER_PRODUCT` never accepts or stores raw purchase text (not part of this lane's request contract at all); no email/token/code values appear in this proof bundle |

Pre-existing, unrelated failure confirmed present on `HEAD` before this
lane's changes (same class already documented in the Lane 7.4B proof):
`tests/matching/store.test.ts` — migration `0007_email_alerts` naming
assertion, untouched by this lane, not part of this lane's proof surface.

## Changed files

- `src/auth/durable-schema.ts` — `discovery_sessions`, `monitoring_enrollment_quotes` tables (+ partial-unique active-quote index)
- `src/auth/auth-store.ts` — store interface + Postgres/SQLite adapter methods for both new tables
- `src/web/agent-preflight-service.ts` — new service module: `discoverProductForAgent`, `confirmProductForAgent`, `preflightMonitoringForAgent`
- `src/web/purchase-service.ts` — exported `PENDING_DISCOVERY_URL` and `purchaseHasExactIdentity` for reuse (no behavior change)
- `src/ai/schemas.ts` — `DiscoveryPurchaseFieldsSchema` + three new `AgentRequestSchema` variants
- `src/ai/agent-service.ts` — dispatch wiring, `AgentServiceDeps`/`AgentServiceResult` extended, `offersOverride` forwarded for tests
- `openapi/nobu-agent-native-paid-monitoring-proposed.openapi.yaml` — marks the three newly implemented actions/schemas, adds `CANDIDATE_NOT_CONFIRMABLE`/`PRODUCT_CONFIRMED` and the existing locked policy statuses to `ContinuationStatus`, keeps unimplemented actions clearly proposed
- `docs/nobu-okx-agent-native-paid-monitoring-architecture.md` — §3.3 updated for the implemented `structured_snapshot_json` field and materialization ordering; §12 build order marks Lane 7.4B/7.4C complete
- `tests/web/agent-preflight.test.ts` — new focused test suite (12 tests)

## Hard locks preserved

- No payment/x402/`START_MONITORING`/activation-ledger/monitor-management/scheduler code added
- ASP #5541 not deployed, edited, or resubmitted
- No raw purchase text, email, code, or token logged or placed in this proof bundle
- Target-only MVP, fail-closed matching/policy, no refund guarantees — untouched
