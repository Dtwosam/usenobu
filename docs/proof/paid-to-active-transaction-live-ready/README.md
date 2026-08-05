# Paid-to-active transaction live-ready closeout (final repair)

**Date:** 2026-08-05  
**Baseline:** `ca83267ed6bbf0aac676c150e4cd4ea262f3dbdd`  
**Code commit:** `53411685a6259e1ad915e9b3e7f650bd921df1cd`  
**Deployment:** `dpl_9XND8k78yfbDfpQq5NSsStEviAhM`  
**Aliases:** `https://www.usenobu.xyz`, `https://usenobu.vercel.app`

## Verdict

**`NOBU_PAID_TO_ACTIVE_TRANSACTION_CLOSEOUT_BLOCKED`**

Code and focused proofs pass. Authenticated Production readiness boolean body is not available in this operator shell: `OWNER_OPS_SECRET` is absent and Vercel CLI redacts Sensitive secrets on `env pull` / `env run`. Do **not** authorize a genuine payment until all six readiness booleans are confirmed `true`.

No genuine payment, ASP `#5541` update, activation, resubmission, or services `33561`/`35958` change occurred.

## Schema changes

`monitoring_pass_payments` gains nullable opaque columns:

- `provider_payment_id` (sanitized string, max 200)
- `provider_authorization_id` (sanitized string, max 200)

Applied in:

- SQLite/Postgres CREATE TABLE (`src/auth/durable-schema.ts`)
- `AUTH_DURABLE_SCHEMA_PATCHES` ALTER TABLE adds
- `MonitoringPassPaymentRow` + `updateMonitoringPassPayment` (SQLite + Postgres)

Never stores: raw `PAYMENT-SIGNATURE`, authorization payload, wallet secret, API credential, or full provider response body.

## Payment-identifier binding design

1. Capture from official verify / settle / settle-status shapes (`paymentId` / `payment_id`, `authorizationId` / `authorization_id`).
2. Sanitize via `src/payments/provider-ids.ts` (trim whitespace only; no forced lowercase).
3. Persist on the original payment row during verify/settle/pending and reconciliation.
4. Provider IDs are **not** compared to Nobu `payment.id` or `authorization_digest`.

### Failed settlement decision

Requires all of:

- conclusive facilitator failure;
- canonical transaction match;
- network / asset / payTo match; amount when returned; payer when known;
- **at least one payment-specific binding:**
  - **A** — canonical tx already on this payment row; or
  - **B** — stored `provider_payment_id` equals facilitator payment id; or
  - **C** — stored `provider_authorization_id` equals facilitator authorization id.

Otherwise: `inconclusive_failure_evidence` + keep `settlement_review_required`.  
Atomic claim still binds the canonical settlement_ref so it cannot unlock another payment.

## Shared outbox delivery design

`processNotificationOutboxOpportunity` is the single delivery function for one durable opportunity:

1. load outbox → reject terminal/sent  
2. atomic lease  
3. reload account, ownership, verified email, consent  
4. parse durable evidence  
5. summary: atomic `tryReserveRollingSummarySend` (rolling 24h only)  
6. provider send with opportunity key as idempotency key  
7. `markRollingSummarySent` / mark outbox `sent` only after success  
8. on failure: release reserve + `failed_retryable`  
9. consent revoked → `suppressed`  
10. config/evidence terminal → `failed_terminal`

`processDueNotificationOutbox` only lists due rows and delegates.  
Initial summary path in `src/notifications/process.ts` creates durable outbox evidence then calls `processNotificationOutboxOpportunity` (no direct `sendSummaryEmail`).

## Changed files (code)

- `src/auth/durable-schema.ts`
- `src/auth/auth-store.ts`
- `src/payments/provider-ids.ts` (new)
- `src/payments/okx-seller-client.ts`
- `src/payments/okx-seller-verifier.ts`
- `src/payments/monitoring-pass-service.ts`
- `src/payments/settlement-review-service.ts`
- `src/notifications/outbox-retry.ts`
- `src/notifications/process.ts`
- `tests/payments/paid-to-active-transaction-final-repair.test.ts` (new)
- `tests/payments/transaction-closeout-live-ready.test.ts`
- `tests/payments/paid-to-active-transaction.test.ts`

## Focused gates

| Gate | Result |
|------|--------|
| Final repair suite (A/B/C) | PASS |
| Live-ready closeout suite | PASS |
| Final transactional audit | PASS |
| Audit-repair suite | PASS |
| Paid-to-active transaction suite | PASS |
| Monitoring Pass suite | PASS |
| Email alerts suite | PASS |
| Combined focused count | **76 passed** (across 5 files in combined run; 35 in core four-file set) |
| `tsc --noEmit` | PASS |
| Production `next build` | PASS |
| `git diff --check` | PASS (CRLF warnings only) |
| Narrow secret/PII scan | PASS (no secrets committed) |

### Focused commands

```bash
npx vitest run tests/payments/paid-to-active-transaction-final-repair.test.ts \
  tests/payments/transaction-closeout-live-ready.test.ts \
  tests/payments/final-transactional-audit.test.ts \
  tests/payments/paid-to-active-audit-repair.test.ts \
  tests/payments/paid-to-active-transaction.test.ts \
  tests/payments/monitoring-pass.test.ts \
  tests/notifications/email-alerts.test.ts
npx tsc --noEmit
npx next build
```

## Production probes (no genuine payment)

| Probe | Result |
|-------|--------|
| `GET /health` | 200 |
| free `POST /v1/agent` `{}` | 400 `SERVICE_SELECTION_REQUIRED` |
| unpaid `POST /v1/agent/monitoring-pass` | 402 + `PAYMENT-REQUIRED` |
| malformed `PAYMENT-SIGNATURE` | 402 |
| config-readiness wrong bearer | 401 |

## Six readiness booleans

**Unavailable in this environment.** `OWNER_OPS_SECRET` is not present in the operator shell; Vercel Sensitive env redaction prevents CLI retrieval.

Exact operator command (never commit the secret):

```bash
read -s OWNER_OPS_SECRET
printf '\n'
curl -fsS https://www.usenobu.xyz/v1/owner/config-readiness \
  -H "Authorization: Bearer ${OWNER_OPS_SECRET}" \
  | python3 -m json.tool
unset OWNER_OPS_SECRET
```

Required booleans (all must be `true`):

- `durable_database_configured`
- `okx_seller_configured`
- `nobu_pass_claim_secret_configured`
- `email_provider_configured`
- `owner_ops_secret_configured`
- `cron_secret_configured`

## Confirmations

- No genuine payment performed
- No ASP `#5541` update / activate / resubmit
- Services `33561` / `35958` unchanged
- Price / token / network / payTo unchanged
- Target-only policy unchanged
- No secrets printed or committed
