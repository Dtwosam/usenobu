# Complete Production Hardening — Audit

**Date:** 2026-07-28  
**Starting HEAD:** `f9f1b2575d2a865a3bb67962452a72bc6afb610d`  
**Method:** code path tracing, Production probes, ASP/A2A readback, comparison of direct tests vs real marketplace evidence

Treat Nobu as **one AI agent experience**, not a bag of endpoints. Failures that only appear when OKX.AI routes tasks are first-class defects.

---

## 1. End-to-end stage map (as implemented today)

| # | Stage | Surface | Expected | Actual production truth |
|---|---|---|---|---|
| 1 | Marketplace discovery | OKX listing ASP `#5541` | Discoverable, both services clear | **Listed** (`approvalDisplayStatus: 4`); free `33561` + paid `35958`; salesCount 3 |
| 2 | Service selection | Caller chooses free vs paid | Clear free setup vs paid pass | Service descriptions accurate; **calling agents still confuse order** (pay first vs setup first) |
| 3 | A2A routing | okx-a2a daemon + A2MCP HTTPS | Tasks accepted promptly | **Local A2A daemon not running** (`ready: false`); A2MCP HTTPS works independently |
| 4 | First-time guidance | Free `/v1/agent` empty | Introduce Nobu + both services | **Marketplace first-contact** returns only `monitoring_pass_id` required — poor for brand-new users; rich descriptor exists in code but free route prefers marketplace first-contact when no action |
| 5 | Purchase Setup | Free journey / actions | Free, sequential | Dual models: **action enum** vs **marketplace journey** without `action` |
| 6 | Monitoring Pass challenge | Paid `/v1/agent/monitoring-pass` | Always 402 on unpaid first contact | **Correct** for empty body |
| 7 | Payment + settlement | x402 verify → settle → settle/status | One charge → one pass | Settle often **pending**; pass not issued until reconcile/resolve/replay |
| 8 | Automatic pass issuance | After on-chain success | Automatic, no owner | **Not automatic** on marketplace completion; owner reconcile historically required |
| 9 | Continuation / resume | `pass_continuation_id` | Reconcile then hand off free setup | Continuation works **if** agent keeps it and calls free resolve/journey — **not if** agent re-invokes paid service empty |
| 10 | Purchase understanding | UNDERSTAND_PURCHASE / journey stage | One question; extract fields | Works; Groq can add latency |
| 11 | Product discovery | DISCOVER_PRODUCT / journey | Bounded Target candidates | Works; SerpApi up to ~20s; marketplace journey returns generic incomplete on empty/fail |
| 12 | Exact confirmation | CONFIRM_PRODUCT | User-selected only; fail closed | Strong; locked fingerprint |
| 13 | Email verification | BEGIN/VERIFY | Code via email; connection token once | Works; OTP not logged |
| 14 | Consent | dual booleans | Explicit true required | Works |
| 15 | Eligibility + quote | PREFLIGHT | Deterministic Target policy | Works; payment-ready not active |
| 16 | Pass redemption | REDEEM_MONITORING_PASS | Exactly once; gates before consume | Works; marketplace path can redeem without connection_token when trusted journey |
| 17 | Monitoring activate | saga project status | MONITORING_ACTIVE | Works with activation_pending recovery |
| 18 | Scheduled/manual checks | monitor-scheduler + check actions | Idempotent; fail closed | Scheduler route exists; **no in-repo Vercel cron** |
| 19 | Alerts | email pipeline | One alert per opportunity; consent | Implemented; needs live proof in this lane |
| 20 | Status / stop / return | free actions | Safe stop; no refund language | Implemented |

---

## 2. Authoritative payment failure (root-cause analysis)

### Observed

1. Real OKX.AI user paid `0.99 USDT` on X Layer  
   - tx `0xead9f6bade3daa2fa27c826bc0bd7853b4ddd9683295e25858b5f5f6b81edf23`  
   - continuation `pass_cont_2adcc866e68b4ed58f6e2bbe9fba3b27`
2. Nobu **did not automatically** put a redeemable pass into the marketplace conversation at settlement time.
3. The flow **still requested payment** (user-facing / agent-facing).
4. Later Production `RESOLVE_MONITORING_PASS` with that continuation returns **`MONITORING_PASS_ISSUED`** (`pass_33539591e6fc486ba5bcdd2169c78c31`).  
   → Issuance is recoverable; **automatic convergence at the moment of payment is not reliable**.

### Root cause inventory

#### RC-PAY-1 — Settlement pending terminalizes without automatic convergence (PRIMARY)

**Where:** `src/payments/monitoring-pass-service.ts` → `monitoringPassForAgent`  
**What:** Official settle often returns `status: pending` with a tx hash. Nobu stores `monitoring_pass_payments` as `verifying` + opaque `settlement_ref`, returns `PAYMENT_SETTLEMENT_PENDING` + `pass_continuation_id`.  
**Gap:** Marketplace job completion does **not** replay `PAYMENT-SIGNATURE`. Prior design required that replay (or owner reconcile) to call settle/status and issue the pass.  
**Repair status:** reconcile + RESOLVE can issue later, but **normal path still leaves users/agents with a pending terminal deliverable** until something else runs.  
**User effect:** “I paid; where is my pass?”

#### RC-PAY-2 — Unpaid re-entry to paid endpoint always re-issues 402 (DUPLICATE PAYMENT APPEARANCE)

**Where:** `app/v1/agent/monitoring-pass/route.ts` + `monitoringPassForAgent`  
**What:** Any request without `PAYMENT-SIGNATURE` and without marketplace-journey body keys returns **402 PAYMENT_PENDING** again.  
**Gap:** After a successful chain payment, OKX.AI / calling agents often re-open the **paid** service for “status.” Empty body → new challenge → **looks like another charge is required.**  
**Note:** Body with `pass_continuation_id` correctly avoids 402 (audit probe). Agents that drop the continuation re-trigger payment UX.  
**User effect:** “It asked me to pay again.”

#### RC-PAY-3 — Automatic reconciliation is not first-class on the hot path

**Where:**  
- `reconcilePendingPassSettlements` (owner route + called from RESOLVE for verifying rows)  
- **No** `vercel.json` cron for settlement reconcile  
**Gap:** Pass issuance after pending depends on: owner cron secret call, or agent calling `RESOLVE_MONITORING_PASS`, or signed replay. Owner path violates “no owner intervention for normal steps.”  
**User effect:** Stuck until manual recovery or lucky resolve.

#### RC-PAY-4 — Inline settle may return pending by default

**Where:** `OkxSellerClient` / `OKX_SYNC_SETTLE` defaults false  
**Gap:** Async settle maximizes `settlement_pending` outcomes. No bounded same-request settle/status poll after pending (beyond later resume).  
**User effect:** Even a correct payment path often cannot return `MONITORING_PASS_ISSUED` on the paid replay request.

#### RC-PAY-5 — Direct tests over-claim success vs marketplace

**Evidence:** Unit tests inject accepting verifiers that settle immediately; owner reconcile proofs issue passes. Marketplace evidence (this tx + earlier jobs) shows **pending deliverable + re-challenge UX**.  
**Rule:** Real marketplace behavior supersedes mock PASS claims.

---

## 3. Conversation / journey failures

#### RC-UX-1 — Two incomplete conversation models

| Model | Entry | State |
|---|---|---|
| Action enum | `{"action":"…"}` | `addJourneyFields` guidance |
| Marketplace journey | body keys without action | stages in `marketplace_purchase_journeys` |

Guidance, field names, and error shapes differ. Calling agents may mix models.

#### RC-UX-2 — Free first contact demands pass id

**Where:** `marketplaceFirstContact()`  
**What:** Empty free service asks only for `monitoring_pass_id`.  
**Gap:** New users without a pass get no clear “buy Monitoring Pass on service 35958 first” machine path that Onchain OS field collector can follow without inventing steps. Rich descriptor exists but is bypassed when `isMarketplaceJourneyRequest` / first-contact routing prefers the pass-id shape.

#### RC-UX-3 — Incomplete responses lack full conversation contract

**Where:** `marketplace-journey.ts` `incomplete()`  
**Missing vs required contract:** consistent `payment_status`, `second_payment_required`, `monitoring_active`, `journey_complete`, `retry_safe`, `guidance`, durable continuation always present when known.

#### RC-UX-4 — Sequential rules partially enforced

Marketplace journey forbids early email/consent (good). Action enum path still allows agents to call email actions out of order if they invent them. Descriptor historically listed email actions prominently → agents skip purchase description (known prior defect; sequential guidance improved but not fail-closed for out-of-order free actions without journey state).

#### RC-UX-5 — After issuance, paid route returns 400 confirm_use_pass

**Where:** `monitoring-pass/route.ts` post-issue → `runMarketplaceJourney`  
**Intent:** keep Onchain OS in input_required field collection.  
**Risk:** Some platform wrappers treat non-2xx as failure; others correctly collect fields. Must keep truthful continuation **and** make payment status unmistakable (`second_payment_required: false`, pass id present).

---

## 4. Latency / reliability failures

#### RC-LAT-1 — Cold starts and health ~1.4–2.1 s

Simple paths meet ~2 s budget when warm; cold can exceed p95 target for guidance.

#### RC-LAT-2 — External calls can dominate

| Dependency | Bound (code) | Risk |
|---|---|---|
| Groq | ~20 s class timeouts | UNDERSTAND_PURCHASE slow |
| SerpApi | ~15–20 s | DISCOVER / checks |
| OKX verify/settle | network | paid path |
| Postgres | 5 s connect / 8 s statement | all durable steps |

No unified “truthful pending + resume” for slow discovery on marketplace journey — generic incomplete.

#### RC-LAT-3 — RESOLVE may scan up to 50 verifying payments

`resolveMonitoringPassForAgent` calls `reconcilePendingPassSettlements({ limit: 50 })` when continuation pending — **unbounded relative to one user**, adds latency and cross-payment work.

#### RC-LAT-4 — No automatic recovery cron

Settlement and monitor schedulers require external Bearer callers; nothing in-repo guarantees periodic settlement convergence.

---

## 5. Security / correctness locks (must preserve)

| Lock | Status in code | Risk if “fixed” badly |
|---|---|---|
| One settlement → one pass (UNIQUE settlement_ref) | Strong | Do not weaken |
| No pass token bearer | Strong | Keep public pass id only |
| No monitoring before confirm+email+consent+eligibility+redeem | Strong | Do not short-circuit |
| Target-only, no Target Plus, fail-closed match | Strong | Do not loosen for speed |
| No caller-controlled ownership/idempotency | Strong | Keep server-derived keys |
| Secrets/OTP/signatures not logged | Strong | Keep redaction |
| Stopped monitors excluded | Strong | Keep |
| No false price-drop on ambiguity/provider fail | Strong | Keep |

---

## 6. Stage-by-stage inspection summary

### 6.1 Discovery / introduction

- Inputs: empty GET/POST free  
- Outputs: marketplace first-contact **or** input_required (route-dependent history)  
- Persisted: none  
- Latency: sub-second warm  
- Defect: **RC-UX-2**

### 6.2 Paid challenge

- Inputs: none  
- Outputs: 402 + PAYMENT-REQUIRED (x402 v2 exact, eip155:196, 990000)  
- Persisted: none on challenge  
- Latency: ~0.6–0.9 s  
- Correct for first contact

### 6.3 Paid settlement replay

- Inputs: PAYMENT-SIGNATURE header  
- Outputs: ISSUED | SETTLEMENT_PENDING | 402 again on fail  
- Persisted: payment row (digest, settlement_ref, status); continuation; pass if settled  
- Defects: **RC-PAY-1, RC-PAY-4**

### 6.4 Continuation resolve

- Inputs: pass_continuation_id or monitoring_pass_id  
- Outputs: ISSUED or still pending  
- Side effect: may reconcile many verifying rows (**RC-LAT-3**)  
- Works for known continuation once settled

### 6.5 Purchase setup → activation

- Marketplace stages: confirm_use_pass → purchase_description → candidate_id → email → verification_code → consents → complete  
- Action path: UNDERSTAND → DISCOVER → CONFIRM → BEGIN_EMAIL → VERIFY → PREFLIGHT → REDEEM  
- Defects: dual model (**RC-UX-1**), incomplete contract (**RC-UX-3**), slow discovery (**RC-LAT-2**)

### 6.6 Monitoring / alerts / stop

- Implemented; scheduler external; idempotent opportunity keys  
- Not the primary marketplace payment failure, but must remain correct under hardening

---

## 7. Differences: direct tests vs real marketplace

| Claim proven by mocks/curl | Marketplace reality |
|---|---|
| Accepting verifier → immediate ISSUED | OKX settle often pending |
| RESOLVE returns ISSUED | User never told to RESOLVE; job already terminalized pending |
| Continuation avoids second 402 | Agent drops continuation → re-402 |
| Owner reconcile recovers | Violates “no owner intervention” for normal flow |
| Free descriptor introduces Nobu | Marketplace first-contact asks only for pass id |
| A2A doctor ready in prior lanes | **Daemon not running now** |

---

## 8. Prior PASS claims to supersede

Any claim that:

- settlement reconciliation alone closes the **user-visible** paid journey without automatic hot-path convergence, or  
- “Monitoring Pass repair PASS” means real OKX users always receive a pass without re-pay or owner help, or  
- ASP is “rejected / not listed” (now listed status 4),

is **superseded** by this audit and real payment evidence.

---

## 9. Confirmed defect list (repair scope)

| ID | Severity | Area |
|---|---|---|
| RC-PAY-1 | P0 | Pending settlement does not auto-converge to one pass on normal path |
| RC-PAY-2 | P0 | Empty re-entry to paid service re-challenges after successful payment |
| RC-PAY-3 | P0 | Reconciliation not automatic without owner/agent luck |
| RC-PAY-4 | P1 | No bounded same-request settle/status poll after pending |
| RC-PAY-5 | P1 | Tests/docs over-claim vs marketplace |
| RC-UX-1 | P1 | Dual conversation models / inconsistent contract |
| RC-UX-2 | P1 | Free first contact pass-id-only for new users |
| RC-UX-3 | P1 | Incomplete journey responses missing full contract fields |
| RC-UX-4 | P2 | Out-of-order free actions possible without journey state |
| RC-UX-5 | P2 | Post-issue HTTP status / field collection clarity |
| RC-LAT-1 | P2 | Cold start guidance latency |
| RC-LAT-2 | P1 | Slow external work without resumable pending |
| RC-LAT-3 | P1 | RESOLVE reconciles up to 50 payments |
| RC-LAT-4 | P1 | No settlement cron / automatic recovery loop |
| RC-A2A-1 | P1 | A2A daemon not running (operator env) — required for full real-user proof |

---

## 10. Audit verdict

**System is not production-complete for A→Z OKX.AI users.**  
Payment can succeed on-chain while the agent experience still demands payment or leaves the user without an automatic pass. Conversation and latency gaps compound that primary failure.

Next: single design document for the canonical state machine + conversation contract, then one coordinated repair change set.
