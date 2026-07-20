# Lane 7.4D — `$0.99` paid monitoring activation

**Verdict:** `NOBU_LANE_7_4D_PASS`

## What shipped

- Durable `payment_attempts` and `monitor_activations` tables
  (`src/auth/durable-schema.ts`) in the **same** durable AuthStore as
  `monitoring_enrollment_quotes` (PostgreSQL production, SQLite tests/local)
  — never the separate per-instance purchases database. `AuthStore`
  (`src/auth/auth-store.ts`) gained matching interface methods and both
  SQLite/Postgres adapter implementations: `getMonitoringEnrollmentQuoteById`,
  `getLatestPaymentAttemptForQuote`, `insertPaymentAttempt`,
  `getMonitorActivationByQuoteId`, `recordSettledPaymentAndActivation`,
  `markMonitorActivationActive`, `listPendingProjectionActivations`.
- Official x402 challenge/verification boundary (`src/payments/x402.ts`): an
  `x402`-shaped `PAYMENT-REQUIRED`/`HTTP 402` challenge bound to one specific
  `quote_id` and resource — never reusable across quotes. The production
  verifier (`notConfiguredVerifier`) **always** reports `not_configured` /
  fails closed, because Lane 7.4D.0's research established only the official
  buyer-side signing CLI (`payment pay`/`payment charge`), never an official
  seller-side settlement-verification contract — fabricating a
  plausible-looking real integration was explicitly rejected in favor of an
  honest gap. `resolveX402Verifier` only accepts an injected test verifier
  when `isAuthTestMode(env)` is true; it throws
  (`x402_test_verifier_forbidden_outside_test_mode`) otherwise, so production
  can never be pointed at a fixture.
- Private, **unregistered** `POST /v1/agent/start-monitoring` route
  (`app/v1/agent/start-monitoring/route.ts`) — a separate route file from the
  existing free `/v1/agent`, not advertised, not part of ASP #5541, not
  deployed. Request body accepts **only** `quote_id` / `connection_id` /
  `connection_token` (Zod `.strict()`); no amount, purchase id, fingerprint
  id, settlement reference, transaction hash, or idempotency key is ever
  accepted from the client. The signed payment replay travels separately, in
  the `PAYMENT-SIGNATURE` header. Every authoritative value (purchase,
  fingerprint, price, quote validity) is reloaded server-side
  (`src/payments/start-monitoring-service.ts#startMonitoringForAgent`).
- **Durable two-phase saga, not one cross-store transaction.** Production
  spans two genuinely separate stores — the durable Postgres `AuthStore` and
  the purchases database (`src/web/db.ts`'s `getWebDatabase()`, per-instance
  `/tmp` SQLite in production, the same store Lane 7.3A.2A.1R already fixed
  for exactly this class of durability bug). No single transaction can span
  both, so the architecture document's original "one durable PostgreSQL
  transaction" design (§7.4) was replaced with:
  1. **Phase 1** (`AuthStore#recordSettledPaymentAndActivation`, one real
     AuthStore transaction): mark the matching `payment_attempts` row
     `settled` with the verified `settlement_ref`; mark the quote `consumed`
     (only if this call is the one that actually transitions it from
     `issued`); insert exactly one `monitor_activations` row keyed on a
     server-derived `activation_key` (`sha256Hex` of
     `quote_id|settlement_ref|purchase_id|fingerprint_id` — never a
     caller-supplied idempotency key) with `status = 'pending_projection'`.
  2. **Phase 2** (`projectActivation`, best-effort, separate purchases
     database): flips `purchases.status` to `MONITORING_ACTIVE`
     (idempotent) and persists the durable account-purchase blob. Can fail
     independently of phase 1, which has already durably recorded the
     settlement.
  3. **Phase 3** (`AuthStore#markMonitorActivationActive`): only once phase
     2 succeeds does the activation flip from `pending_projection` to
     `active`.
- **Idempotency-first ordering:** `startMonitoringForAgent` looks up
  `monitor_activations` by `quote_id` *before* running any payment logic. An
  existing `active` row returns `200 ALREADY_ACTIVE` with the original
  `monitor_id` — never a second payment, never a second `purchases` or
  `monitor_activations` row, never `HTTP 409`. An existing
  `pending_projection` row returns `200 ACTIVATION_PENDING` — truthful,
  never re-requests payment.
- **Concurrency safety without external locks:** database `UNIQUE`
  constraints alone (`payment_attempts` partial-unique on
  settled-per-quote, `monitor_activations` unique on both `quote_id` and
  `activation_key`) enforce exactly-once activation. A losing concurrent
  transaction's `UNIQUE`-violation is caught (`isUniqueViolationError`,
  matching SQLite's message shape and Postgres error code `23505`) and
  treated as a lost race, not a failure — it rolls back and falls through to
  a post-transaction read of the winning row, exactly like the existing
  `ON CONFLICT DO NOTHING` pattern used elsewhere in this store.
- **Reconciliation** (`reconcilePendingActivations`): periodically retries
  phase 2 alone for every `monitor_activations` row still
  `pending_projection`, using only the already-recorded, verified
  `settlement_ref` — never re-verifies payment, never requests a new charge.
- **Fail-closed boundaries:** an unauthorized connection or a quote this
  connection did not create never even reaches the payment step (no
  `payment_attempts` row created). An expired quote, or a quote whose price
  no longer matches the required exact `$0.99`, fails closed the same way,
  before a payment attempt can exist. An invalid or altered payment (failed
  verifier) never activates and re-issues the same `402` challenge, never a
  new one.
- Updated `docs/nobu-okx-agent-native-paid-monitoring-architecture.md` (§7.4
  replaced with the durable saga, §7.6 replaced with the real reconciliation
  behavior, §6 schema corrected to match implemented columns, §10/§12
  updated to IMPLEMENTED/COMPLETE), `docs/nobu-current-state.md`,
  `docs/nobu-build-order.md`, and
  `openapi/nobu-agent-native-paid-monitoring-proposed.openapi.yaml`
  (`StartMonitoringRequest`/`Response` schemas corrected to the real 3-field
  body and real status set including `ACTIVATION_PENDING`; response codes
  corrected to what the implementation actually returns).

## Not built (hard locks)

ASP #5541 was not edited, resubmitted, or created. The paid service was not
registered with OKX and the endpoint is not deployed or publicly advertised
— it exists only as a private, unregistered route in the codebase. No fake
payments, transactions, or revenue were fabricated anywhere in code, tests,
or this proof bundle; the accepting test verifier is clearly labelled
`test-fake-*` and is unreachable outside `NOBU_AUTH_TEST_MODE`. No raw
payment header, signature, or private-key material is logged, stored, or
persisted — `payment_attempts` stores only an opaque `settlement_ref`, never
the raw header. Existing free `/v1/agent` behavior is untouched (separate
route file; no shared code path modified).

## Proof

| Check | Result |
|---|---|
| Invalid connection / cross-owner quote issues no payment challenge, no `payment_attempts` row | `tests/payments/start-monitoring.test.ts` — pass |
| Unpaid request receives a correctly quote-bound `402` (`resource`, `quote_id`, `990000` atomic units, non-empty header) | same file — pass |
| A rejecting/invalid payment verifier never activates monitoring; purchase stays `MONITORING_PAYMENT_READY` | same file — pass |
| First verified settlement creates exactly one payment (`settled`) and one activation (`active`), flips purchase to `MONITORING_ACTIVE` | same file — pass |
| Concurrent duplicate settlement (`Promise.all`, same quote): exactly one settled payment, one activation, both callers resolve to the same `monitor_id`, statuses `{MONITORING_STARTED, ALREADY_ACTIVE}`; a later sequential replay also returns `ALREADY_ACTIVE` | same file — pass |
| A purchases-store outage at the moment of settlement (fake verifier deletes the purchase row as a side effect) returns `ACTIVATION_PENDING`, never re-requests payment, settlement stays `settled`; a replay while still pending also returns `ACTIVATION_PENDING`; reconciliation later activates exactly once and is idempotent on a second pass | same file — pass |
| Expired quote (`expires_at` in the past) fails closed, no payment challenge | same file — pass |
| Altered quote (tampered `price_amount`) fails closed, no payment challenge | same file — pass |
| Existing free `/v1/agent` actions unaffected (invalid action, `CHECK_CONFIRMED_PURCHASE`) | same file — pass |
| `tests/payments/start-monitoring.test.ts` | **9/9 passed** |
| Directly affected regressions: `tests/web/agent-preflight.test.ts` (15), `tests/auth/agent-connections.test.ts` (12), `tests/auth/passwordless-auth.test.ts` (8), `tests/monitoring/monitoring.test.ts` (7), `tests/a2mcp/a2mcp.test.ts` (15), `tests/matching/locked-fingerprint-monitor.test.ts` (9) | **66/66 passed** |
| typecheck (`tsc --noEmit`) | pass |
| build (`next build`) | pass — new route present in build output (`/v1/agent/start-monitoring`) |
| `git diff --check` | clean |
| Targeted secret/payment-header scan (new/changed `src/payments`, `app/v1/agent/start-monitoring`, `src/auth/auth-store.ts` diff) | pass — no raw payment header, signature, or private-key material logged, stored, or persisted; `payment_attempts` stores only an opaque `settlement_ref` |

Pre-existing, unrelated failure confirmed present on the base commit before
this lane's changes (via `git stash`, same class already documented in the
Lane 7.4B/7.4C proof bundles): `tests/matching/store.test.ts` — migration
`0007_email_alerts` naming assertion, untouched by this lane, not part of
this lane's proof surface.

## Changed files

- `src/auth/durable-schema.ts` — `payment_attempts`, `monitor_activations` tables
- `src/auth/auth-store.ts` — `PaymentAttemptRow`/`MonitorActivationRow` types, 7 new `AuthStore` interface methods, SQLite + Postgres adapter implementations, shared `isUniqueViolationError` helper for the concurrent-settlement race
- `src/payments/x402.ts` — new file: x402 challenge/verification types, `buildX402Challenge`, `encodeX402ChallengeHeader`, `notConfiguredVerifier`, `resolveX402Verifier`
- `src/payments/start-monitoring-service.ts` — new file: `startMonitoringForAgent` orchestration, `projectActivation`, `resolveActivationResponse`, `reconcilePendingActivations`
- `app/v1/agent/start-monitoring/route.ts` — new file: private `POST /v1/agent/start-monitoring` route
- `tests/payments/start-monitoring.test.ts` — new focused test suite (9 tests)
- `docs/nobu-okx-agent-native-paid-monitoring-architecture.md` — §7.4/§7.6 replaced with the durable saga + reconciliation actually implemented; §6 schema corrected; §10 status table and §12 Lane 7.4D entry marked implemented/complete
- `docs/nobu-current-state.md`, `docs/nobu-build-order.md` — Lane 7.4D marked complete with verdict and evidence pointer
- `openapi/nobu-agent-native-paid-monitoring-proposed.openapi.yaml` — `StartMonitoringRequest`/`Response` corrected to the real 3-field body and response shape; `ACTIVATION_PENDING` added to `ContinuationStatus`; response codes corrected to what the route actually returns
- `docs/proof/lane-7-4d-paid-activation/README.md` — this file

## Hard locks preserved

- No second monitor entity — `monitor_id` is the existing `purchases.id`, reused verbatim
- No activation before verified settlement; no duplicate charge or activation (enforced by database `UNIQUE` constraints, not external locks)
- No raw payment headers/signatures/private-key material in storage, logs, or this proof bundle
- No fake transaction, payment, or revenue claims anywhere in code, tests, or proof
- ASP #5541 not edited, resubmitted, modified, or created
- Not deployed; the paid endpoint is not publicly reachable
- Existing free `/v1/agent` behavior unchanged (separate route file, no shared code path modified)
