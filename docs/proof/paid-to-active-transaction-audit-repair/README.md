# Paid-to-active transaction audit repair

**Date:** 2026-08-05  
**Baseline:** `1c91472a96c836e45d02ef06e8f826ff387acc1c`  
**Verdict:** `NOBU_PAID_TO_ACTIVE_TRANSACTION_FINAL_PASS`

## Scope

Independent source-audit follow-up blockers for the paid → active Monitoring Pass path.

Hard locks held:

- No genuine payment
- No ASP `#5541` / services `33561`/`35958` / price / token / network / payTo / Target-only policy changes
- Untracked nested `usenobu/` and temp patch scripts moved outside the repo (not committed)

## Repairs

### 1. Claim resolution + atomic journey creation

- `resolveMonitoringPassForAgent` is **read-only** for claim consumption (never calls `consumeContinuationClaimCredential`).
- Only `claimPassAndCreateJourney` validates hash, creates/resolves the unique journey, consumes the credential, and commits atomically.
- Already-consumed claims recover the existing journey **only** when the supplied credential hash still matches.
- Invalid credentials after consumption cannot retrieve the journey.
- Public pass / continuation IDs alone cannot create or authorize a journey; after claim, continuation uses `journey_id`.
- Real sequence proof: paid response → `pass_claim_credential` → `runMarketplaceJourney` → journey created (no store-primitive substitute).

### 2. Concurrency-safe continuation + fail-closed secret

- `ensureContinuation`: insert/resolve unique continuation → winning id → derive credential from `payment_id + continuation_id` → store hash if absent → reread/verify → return credential for stored row.
- Five concurrent first successful replays → one pass, one continuation, one identical usable claim credential.
- Dedicated `NOBU_PASS_CLAIM_SECRET` only (no silent `SESSION_SECRET` fallback).
- Missing secret → `PASS_HANDOFF_CONFIGURATION_REQUIRED` / fail closed (no claimless public-ID path).

### 3. Durable schedule as scheduler source of truth

- Work source: `listDueDurableMonitorSchedules` (`status = active`, due `next_check_at`, backoff elapsed).
- Keyset: `ORDER BY purchase_id ASC` with `purchase_id > cursor` on every page.
- Blocked/stopped/expired schedules never occupy due pages.
- Bootstrap schedules from activations; hydrate validates blob + active activation.
- Global lease acquired with `BEGIN IMMEDIATE` serialization; release in `finally`.
- Lease TTL 10 minutes; dual-worker proof: one lease winner; durable monthly budget globally bounded.
- Proof ≥80 records with mixed blocked/stopped and non-creation purchase-id order.

### 4. Real durable outbox worker

- `processDueNotificationOutbox`: list due pending / failed_retryable / expired sending → atomic lease (including reclaim expired `sending`) → reconstruct evidence from `evidence_json` → provider send → mark sent only after success → bounded backoff.
- Production path uses real email provider (test mode captures); missing evidence → `missing_outbox_evidence` (not `retry_requires_evidence_reload`).
- Summary path inserts durable outbox + leases before send (not local-SQLite-only direct send).
- Deterministic Resend `Idempotency-Key` from `opportunity_key` where supported.
- Proof: concurrent workers one provider call; reclaim; retry then success; sent never resends; summary once.

### 5. Evidence-based settlement review

- `POST /v1/owner/settlement-review` is **owner-only** (`OWNER_OPS_SECRET` via `authorizeOwnerRequest`), not general cron.
- `decision=settled` requires independent facilitator `settle/status` verification: final success, network `eip155:196`, amount `990000`, asset/recipient when present match locked terms.
- Unconfirmed / uncertain evidence keeps `settlement_review_required` (does not unlock repayment).
- Conclusive failure required for `decision=failed`.
- Immutable sanitized `settlement_review_audit` (payment id, decision, evidence source, ref hash, reviewer key id, timestamp). No raw signatures or API credentials.

## Focused gates

| Gate | Result |
|------|--------|
| Canonical x402 equality | PASS |
| Claim / handoff / marketplace journey | PASS |
| Scheduler orchestration (bridge + multi-page) | PASS |
| Durable outbox worker | PASS |
| Settlement review service | PASS |
| Typecheck (`tsc --noEmit`) | PASS |
| Production build (`next build`) | PASS |
| `git diff --check` | PASS |
| Narrow secret/PII scan | PASS (no live secrets) |

Focused suite: `tests/payments/paid-to-active-audit-repair.test.ts` + related claim/scheduler/outbox/marketplace/canonical tests — **51/51**.

## Production

Deploy only after focused proof (this document). Production probes remain unpaid and malformed-only. No genuine payment, ASP update, activation, resubmission, wallet funding, new Agent, or new service.

## Status progression

1. Pre-repair audit state: `NOBU_PAID_TO_ACTIVE_TRANSACTION_FOLLOWUP_AUDIT_BLOCKED`
2. After this repair + independent focused proof: `NOBU_PAID_TO_ACTIVE_TRANSACTION_FINAL_PASS`
