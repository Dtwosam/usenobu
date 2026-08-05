# Paid-to-active transactional follow-up repair

**Date:** 2026-08-05  
**Baseline:** `08da02a7087ce3738920c7c0b4c516a71a5a05c1`  
**Code commit:** `617e78395a7e65174549b4094c34e0c55ca36fef`  
**Deployment ID:** `dpl_2tCWNPvVnx2DdKDmFYfiucrQFFvz`  
**Aliases:** `https://www.usenobu.xyz`, `https://usenobu.vercel.app`  
**Verdict:** `NOBU_PAID_TO_ACTIVE_TRANSACTION_FOLLOWUP_PASS`

## Audit blockers repaired

### 1. Identical PaymentRequirements challenge → verify → settle

- Single builder: `src/payments/canonical-requirements.ts`
- Uses `@okxweb3/x402-evm` `ExactEvmScheme.parsePrice` / `enhancePaymentRequirements`
- Official eip155:196 extra: `name: USD₮0`, **`version: "1"`** (package `getDefaultAsset`)
- No `/supported`-only mutation on replay
- Deep-equality test: `tests/payments/canonical-requirements.test.ts`

### 2. Recoverable atomic pass claim

- HMAC-derived claim: `src/payments/claim-credential.ts` (hash only stored)
- Same unconsumed credential re-derived on payment replay after response loss
- Atomic `AuthStore.claimPassAndCreateJourney` — journey insert then claim consume in one transaction
- Public `monitoring_pass_id` alone → `MONITORING_PASS_RECOVERY_REQUIRED` (no silent continuation mint)

### 3. Durable scheduler control plane wired

- Multi-page cursor (no first-page-only break)
- Global lease released in `finally`
- Durable search-budget reservation before provider fetch (`scheduler.ts`)
- Outbox retry phase on monitor-scheduler

### 4. Authoritative durable notification outbox

- Durable opportunity reserve + outbox lease **before** provider send
- Local ledger is mirror only
- `processDueNotificationOutbox` for pending/failed_retryable + expired sending leases

### 5. SETTLEMENT_REVIEW_REQUIRED

- No tx / no queryable id → `SETTLEMENT_REVIEW_REQUIRED` (not “auto-reconcile will succeed”)
- Operator path: `POST /v1/owner/settlement-review` with verified `transaction_hash` evidence for settled, or failed — never fabricates settlement

## Focused tests

| Suite | Result |
|---|---|
| `canonical-requirements.test.ts` | 2/2 |
| `claim-and-scheduler-followup.test.ts` | 5/5 |
| `paid-to-active-transaction.test.ts` | 18/18 |
| `monitoring-pass.test.ts` | 27/27 |
| `okx-seller-adapter.test.ts` | 11/11 |
| **Total** | **63/63** |
| `tsc --noEmit` | pass |
| `next build` | pass |
| Secret scan | clean |

## Production-safe probes (no genuine payment)

| Probe | Result |
|---|---|
| Unpaid paid endpoint | 402 + PAYMENT-REQUIRED, exact eip155:196 990000, extra.version 1 |
| Neutral body | no never_ask prose |
| Malformed PAYMENT-SIGNATURE | 402 rejected |
| Free alias re-pointed | usenobu.vercel.app → this deploy |

No genuine payment, ASP update, activation, resubmission, wallet funding.

## Remaining boundaries

- Real User-role A→Z with one 0.99 USDT payment still optional operator step
- Facilitator finality timing remains platform-controlled
- ASP #5541 / service IDs / price / network / token / payTo unchanged
