# Paid-to-active transaction closeout

**Date:** 2026-08-05  
**Baseline:** `50c0d5414add2cedd335b0aa105dbaa4c0c31ca5`  
**Pre-repair status:** `NOBU_PAID_TO_ACTIVE_TRANSACTION_FINAL_AUDIT_BLOCKED`  
**Verdict:** `NOBU_PAID_TO_ACTIVE_TRANSACTION_CLOSEOUT_PASS`

## Locks held

- No genuine payment
- No Agent 5541 / services 33561/35958 / price / token / network / payTo / Target-only / ASP registration changes

## Repairs

### 1. Bootstrap never revives terminal schedules

- `insertDurableMonitorScheduleIfMissing` → `INSERT … ON CONFLICT DO NOTHING`
- Bootstrap uses only that method (never status-changing upsert)
- Bootstrap runs **under** the global scheduler lease
- Proof: blocked/stopped/expired unchanged after repeated bootstrap; >200 blocked cannot occupy due pages; provider ids exclude terminals; new activation gets exactly one schedule

### 2. Settlement evidence bound to one payment

- Settled path requires network, amount `990000`, asset, payTo, and payer match when known
- Missing commercial fields keep `settlement_review_required`
- `settlement_ref_claims` unique on settlement_ref
- Atomic `claimSettlementReviewDecision`: verify → claim ref → mark payment → audit
- Tx bound to payment A cannot settle/fail payment B; concurrent reviews one winner

### 3. Outbox consent revalidation

- Before every send: durable blob consent enabled, account match, email verified
- Consent revoked → `suppressed` / `consent_revoked` (no provider call)
- Summary uses durable subject/body (`sendSummaryEmailDirect`), not single-drop template
- Durable `durable_account_notification_rate` for one summary per UTC-day window

### 4. Production claim configuration readiness

- `GET /v1/owner/config-readiness` (owner-only)
- Booleans only: durable DB, OKX seller, `NOBU_PASS_CLAIM_SECRET`, email provider, owner ops secret, cron secret
- Never returns secret values, lengths, hashes, or prefixes

## Focused gates

| Gate | Result |
|------|--------|
| Scheduler source-of-truth / bootstrap | PASS |
| Settlement binding | PASS |
| Outbox consent + summary | PASS |
| Config readiness | PASS |
| Related claim/scheduler/outbox suites | PASS |
| Typecheck | PASS |
| Production build | PASS |
| `git diff --check` | PASS |
| Narrow secret scan | PASS |

## Production

- Code: `c777841`
- Proof: `d316d46`
- Deploy READY → `https://www.usenobu.xyz` (`usenobu-ajofjkdjc-…`)

Probes (unpaid/malformed only): health 200; free POST `{}` 400; unpaid monitoring-pass 402; malformed signature 402; config-readiness without owner secret 401/503.

No genuine payment, ASP update, activation, or resubmission.
