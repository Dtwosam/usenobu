# Paid-to-active transactional repair

**Date:** 2026-08-05
**Baseline:** clean `df6792d6ca978a41abff5a99bdcbd5cdbdc31654`
**Code commit:** `243efa7ca58840bc9ed59842b33ae2719d866787`
**Deployment ID:** `dpl_5QAjtR215oFF56GT3PmYpxeQU9me`
**Production aliases:** `https://www.usenobu.xyz`, `https://www.usenobu.xyz`
**Verdict:** `NOBU_PAID_TO_ACTIVE_TRANSACTION_REPAIR_PASS`

## Live failure addressed

A real buyer approved the correct amount/network/token/payTo, but replay ended with:

`facilitator non-terminal: HTTP 402`

No txHash or payment receipt was returned. This lane repairs the resource-server path so successful settlement returns HTTP 200 + `PAYMENT-RESPONSE` + `MONITORING_PASS_ISSUED`, and uncertain settlement becomes `settlement_unknown` without a second challenge. **No genuine payment was made in this lane.**

## Stage-by-stage state machine

| Stage | Durable state | Outcome |
|---|---|---|
| Unpaid contact | (none) | HTTP 402 + `PAYMENT-REQUIRED` (x402 v2 exact, eip155:196, 990000) |
| Signature received | `authorization_received` → `verifying` | Server-built requirements; digest only stored |
| Verify fail | `rejected` / `failed` | Safe re-challenge; no pass |
| Settle pending | `settlement_pending` | Bounded poll; optional 200 pending + receipt |
| Settle transport ambiguous | `settlement_unknown` | **No** new challenge; no auto re-charge |
| Settle success | `settled` | Exactly one pass (`UNIQUE settlement_ref`) |
| Pass issued | continuation + claim hash | `PAYMENT-RESPONSE`; claim secret once to paid caller |
| Free setup claim | claim credential consumed | Journey create; public ids alone insufficient |
| Email verified | connection_token authoritative | Preflight/redeem require token |
| Quote | `issued` (one usable) | Atomic expire stale issued before insert |
| Redeem | pass consumed + activation `pending_projection` | Atomic AuthStore txn |
| Projection | `active` | Scheduler-eligible graph; reconcile without buyer online |
| Scheduler | durable due/lease/budget | Global lease; cursor pages; hydration blockers |
| Alert | outbox `pending`→`sending`→`sent` | Mark sent only after provider success |

## Root causes repaired

1. **Protocol drift / missing receipt** — success path lacked official `PAYMENT-RESPONSE` and could re-return 402 after paid replay.
2. **Ambiguous settle treated as terminal failure** — transport errors after settle submission now become `settlement_unknown`.
3. **Unpaid body imperative prose** — replaced with neutral typed facts.
4. **Public pass id as claim** — single-use `pass_claim_credential` (hash only in DB).
5. **`trustedMarketplaceJourney` auth bypass** — removed; connection token required after email verification.
6. **Expired quotes blocking unique index** — atomic expire-then-insert.
7. **pending_projection required buyer** — reconcile on monitor-scheduler first phase.
8. **Local SQLite as only control plane** — durable lease/schedule/budget/outbox tables.
9. **Notification pre-send `sent`** — pending/sending/sent outbox with lease.
10. **Hydration silent partial import** — structured durable blockers.

## Packages

- `@okxweb3/x402-core@0.1.0` — challenge/response encode, types
- `@okxweb3/x402-evm@0.2.1` — exact scheme helpers (available)
- `@okxweb3/x402-next` **not** installed (peer Next 16 conflict); lower-level server primitives used so pass issuance never runs pre-settlement

Locked terms unchanged: x402 v2, exact, `eip155:196`, token `0x779ded0c9e1022225f8e0630b35a9b54be713736`, amount `990000`, Agent `5541`, services `33561`/`35958`.

## Migrations / schema

`src/auth/durable-schema.ts` + patches:

- Payment diagnostics: payer_address, sanitized reasons, last_provider_operation, attempt_count
- Pass claim: claim_credential_hash, claim_credential_consumed_at
- Durable control plane: durable_monitor_schedule, durable_global_leases, durable_search_budget, durable_alert_opportunities, durable_notification_outbox

## Changed files (code commit)

- `app/v1/agent/monitoring-pass/route.ts`
- `src/payments/{x402,okx-seller-client,okx-seller-verifier,monitoring-pass-service,redeem-monitoring-pass}.ts`
- `src/auth/{durable-schema,auth-store}.ts`
- `src/a2mcp/marketplace-journey.ts`
- `src/web/agent-preflight-service.ts`
- `src/monitoring/{durable-bridge,graph-hydration}.ts`
- `src/notifications/{process,types}.ts`
- `package.json` / `package-lock.json`
- Focused tests under `tests/payments/` and `tests/a2mcp/user-role-journey-contract.test.ts`

## Focused tests

| Suite | Result |
|---|---|
| `tests/payments/paid-to-active-transaction.test.ts` | 18/18 |
| `tests/payments/monitoring-pass.test.ts` | 27/27 |
| `tests/payments/okx-seller-adapter.test.ts` | 11/11 |
| `tests/a2mcp/user-role-journey-contract.test.ts` | 10/10 |
| **Total** | **66/66** |
| `tsc --noEmit` | pass |
| `next build` | pass |
| `git diff --check` | clean (CRLF warnings only) |
| Narrow secret/PII scan | clean |

## Production-safe probes (no genuine payment)

| Probe | Result |
|---|---|
| Unpaid `POST https://www.usenobu.xyz/v1/agent/monitoring-pass` `{}` | **402**, `PAYMENT-REQUIRED` present, x402 v2 exact eip155:196 amount 990000 |
| Unpaid body | `PAYMENT_PENDING`, `business_input_required: false`, no `never_ask_user_for`, amount 990000, `monitoring_active: false` |
| Malformed `PAYMENT-SIGNATURE: not-valid` | **402** `PAYMENT_REJECTED` + challenge header |
| Deploy URL unpaid | **402** |
| Free alias re-pointed | `www.usenobu.xyz` → this deployment |

Not performed (lane locks): genuine payment, ASP update/activation/resubmission, wallet funding, new Agent/service.

## Remaining platform-controlled boundary

- Buyer wallet approval UX and Onchain OS job wrappers remain platform-controlled.
- Official OKX facilitator finality timing remains provider-controlled; Nobu reconciles pending/unknown without second charge.
- ASP `#5541` was **not** mutated; service IDs/endpoints/price unchanged.
- Live end-to-end User-role payment with a real `0.99 USDT` spend is still an optional operator step outside this lane.

## Operator notes

```http
POST https://www.usenobu.xyz/v1/owner/pass-settlement-reconcile
Authorization: Bearer <CRON_SECRET or OWNER_OPS_SECRET>
```

```http
GET|POST https://www.usenobu.xyz/v1/owner/monitor-scheduler
Authorization: Bearer <CRON_SECRET>
```

Scheduler now runs settlement reconcile + activation reconcile before the check tick.
