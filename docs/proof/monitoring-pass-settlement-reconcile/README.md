# Monitoring Pass settlement reconciliation repair

**Date:** 2026-07-26
**Verdict:** `NOBU_MONITORING_PASS_SETTLEMENT_RECONCILE_PASS`
**Baseline:** clean `91c048639ca4792dd1cb5a7d04557c821ccbbcc2`

## Live blocker (read-only context)

| Field | Value |
|---|---|
| Job ID | `0xc88442a4bda90383c45b5c02102185a72d20f6bbeb2f39a70a519157a1650632` |
| Task transaction | `0x6e0042b888694681379375c338817dc848cba9e1a5e8dd7e6c07836e14b145e2` |
| On-chain outcome | `0.99` USDT released |
| Nobu deliverable | `status: PAYMENT_SETTLEMENT_PENDING` — no Monitoring Pass |

No second payment, signed-header replay, task creation, ASP edit, activation, or resubmission was performed in this lane.

## Root cause

1. **Durable pending record:** on OKX settle `pending`, Nobu upserts `monitoring_pass_payments` with `status = verifying`, `authorization_digest = sha256(PAYMENT-SIGNATURE)` (never the raw header), and `settlement_ref = pendingTxHash` (opaque settle transaction).
2. **Digest / settlement ref stored:** yes — digest and pending tx hash are durable; the signed header is not.
3. **`settle/status` after pending:** only when the **same** signed payment header was replayed (`resumePendingPassSettlement`). Marketplace job completion does not replay.
4. **Why reconciliation did not issue:** no provider scan of verifying rows existed; no owner/cron recovery path; no automatic settle/status without the buyer header.
5. **Server-side recovery without replay:** yes, after this repair — poll settle/status from stored `settlement_ref` alone.
6. **Safe exactly-once from existing payment:** yes — issuance remains `UNIQUE (settlement_ref)`; reconciliation never calls verify/settle and never mints a new challenge.

## Repair

| Piece | Behavior |
|---|---|
| `listVerifyingMonitoringPassPayments` | Rows still `verifying` with non-null `settlement_ref` |
| `listSettledMonitoringPassPaymentsWithoutPass` | Crash recovery: settled payment, missing pass |
| `reconcilePendingPassSettlements` | settle/status → mark settled → issue exactly one pass |
| `POST /v1/owner/pass-settlement-reconcile` | Bearer `OWNER_OPS_SECRET` or `CRON_SECRET`; returns public pass ids only |
| Pending guidance | Wait for provider reconciliation; do not pay again |

## Focused checks

| Check | Result |
|---|---|
| `npx vitest run tests/payments/monitoring-pass.test.ts` | 22/22 passed |
| Related: `okx-seller-adapter`, `start-monitoring`, `start-monitoring-route-guidance` | 27/27 passed |
| Focused: pending later confirms → exactly one pass | passed |
| Focused: repeated/concurrent reconcile cannot duplicate or re-charge | passed |
| `npx tsc --noEmit -p tsconfig.json` | passed |
| Limited secret scan on changed files | clean — only negative assertions that `monitoring_pass_token` is undefined |

No full suite. No live payment or signed replay.

## Exact safe operator recovery (after deploy)

```http
POST https://www.usenobu.xyz/v1/owner/pass-settlement-reconcile
Authorization: Bearer <CRON_SECRET or OWNER_OPS_SECRET>
```

Expected: `ok: true`, `issued >= 1`, `issued_pass_ids: ["pass_…"]` for confirmed settlements.
Do **not** pay again, create another task, or replay a signed payment header.
Then continue free service `33561` action `UNDERSTAND_PURCHASE`. Monitoring remains inactive until successful redemption.

## Changed files

- `src/auth/auth-store.ts`
- `src/payments/monitoring-pass-service.ts`
- `app/v1/owner/pass-settlement-reconcile/route.ts`
- `tests/payments/monitoring-pass.test.ts`
- `docs/nobu-current-state.md`
- `docs/nobu-build-order.md`
- `docs/proof/monitoring-pass-settlement-reconcile/README.md`
