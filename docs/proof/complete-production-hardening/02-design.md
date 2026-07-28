# Complete Production Hardening — Design

**Date:** 2026-07-28  
**Depends on:** `01-audit.md`  
**Rule:** Implementation follows this design only. No partial bug lanes.

---

## 1. Product model (canonical)

Nobu is **one agent** with two marketplace services:

| Service | ID | Fee | Role |
|---|---|---|---|
| Nobu Purchase Setup | 33561 | free | Everything except buying the pass |
| Nobu Monitoring Pass | 35958 | 0.99 USDT | Buy exactly one Monitoring Pass |

**Rules users must always hear:**

1. Purchase Setup is free; the pass costs **0.99 USDT** once.  
2. Buying a pass **does not** start monitoring.  
3. Monitoring starts only after: exact product confirmation → verified email → both consents → eligibility → pass redemption.  
4. Target makes the final adjustment decision; Nobu never guarantees refunds/savings.  
5. After a successful settlement, **never pay again**.

**Recommended order for new users:**

1. Understand both services.  
2. Buy Monitoring Pass (35958) once **or** resume if already paid.  
3. Complete free Purchase Setup (33561) and redeem.

(Returning users with a pass skip payment.)

---

## 2. Canonical server-owned state machine

Server state is durable. Client/agent messages never invent status.

```
                    ┌─────────────────┐
                    │  AGENT_INTRO    │
                    └────────┬────────┘
                             │
              ┌──────────────┴──────────────┐
              ▼                             ▼
     NEEDS_MONITORING_PASS          HAS_PASS / ISSUED
              │                             │
              ▼                             ▼
     PAYMENT_CHALLENGE              CONFIRM_USE_PASS
              │                             │
              ▼                             ▼
     PAYMENT_SUBMITTED              PURCHASE_INTAKE
     (settlement pending)                   │
              │                             ▼
              ▼                      PRODUCT_DISCOVERY
     PASS_ISSUED ──────────────────►        │
              │                             ▼
              │                      PRODUCT_CONFIRMED
              │                             │
              │                             ▼
              │                      EMAIL_PENDING
              │                             │
              │                             ▼
              │                      EMAIL_VERIFIED
              │                             │
              │                             ▼
              │                      CONSENT_PENDING
              │                             │
              │                             ▼
              │                      ELIGIBLE_QUOTE_READY
              │                             │
              │                             ▼
              │                      REDEEMING
              │                             │
              │              ┌──────────────┴──────────────┐
              │              ▼                             ▼
              │     MONITORING_ACTIVE              ACTIVATION_PENDING
              │              │                             │
              │              ▼                             │
              │     (status / alert / stop) ◄──────────────┘
              │
              └── FAIL_CLOSED_* (ineligible, match fail, consent declined,
                  invalid code, provider outage, wrong seller, …)
```

### State meanings

| State | Payment | Pass | Monitoring | User next |
|---|---|---|---|---|
| AGENT_INTRO | none | none | no | Choose: buy pass or continue with pass id/continuation |
| NEEDS_MONITORING_PASS | required | none | no | Use service 35958 once |
| PAYMENT_CHALLENGE | required | none | no | Sign and settle x402 challenge |
| PAYMENT_SUBMITTED | pending | none | no | Wait; retry resolve; **never pay again** |
| PASS_ISSUED | recognized | issued | no | Confirm use → purchase details |
| CONFIRM_USE_PASS | recognized | issued | no | confirm_use_pass=true |
| PURCHASE_INTAKE | recognized | issued | no | purchase description only |
| PRODUCT_DISCOVERY | recognized | issued | no | select candidate_id |
| PRODUCT_CONFIRMED | recognized | issued | no | email |
| EMAIL_PENDING | recognized | issued | no | verification code |
| EMAIL_VERIFIED | recognized | issued | no | both consents |
| CONSENT_PENDING | recognized | issued | no | monitoring_consent + email_alert_consent |
| ELIGIBLE_QUOTE_READY | recognized | issued | no | redeem (automatic on marketplace journey) |
| REDEEMING / ACTIVATION_PENDING | recognized | redeeming | no/pending | status only; no second pay/redeem |
| MONITORING_ACTIVE | recognized | redeemed | **yes** | status / wait for alerts / stop |
| STOPPED | recognized | redeemed | no | history kept; no refund |

---

## 3. Conversation-response contract

Every Nobu-controlled JSON response **must** include (top-level):

| Field | Type | Purpose |
|---|---|---|
| `status` | string | Machine status enum |
| `completed_step` | string | What just finished |
| `next_action` | string | What the agent should do next |
| `required_user_input` | object \| null | Human+machine description of needed input |
| `fields` | string[] \| null | Onchain OS field collector |
| `requiredArgs` | string[] \| null | Same as fields (OS 4.4.0) |
| `message` | string | Short user-facing truth |
| `guidance` | string | Agent-facing sequential instruction |
| `payment_status` | `not_required` \| `required` \| `pending` \| `recognized` | Payment clarity |
| `second_payment_required` | boolean | Always false after settlement recognized |
| `monitoring_active` | boolean | |
| `journey_complete` | boolean | true only when monitoring active (or explicit complete) |
| `retry_safe` | boolean | Whether repeating this request is safe |
| `pass_continuation_id` | string \| optional | Durable handoff |
| `monitoring_pass_id` | string \| optional | Public pass id when known |
| `journey_id` | string \| optional | Durable free-setup journey |
| `documentation` | string | https://www.usenobu.xyz/okx |

**Never expose:** payment signatures, digests, settlement tx hashes (to clients), OTP codes, connection tokens (except the one-time VERIFY response), API secrets.

---

## 4. Path-specific guidance (required)

| Path | status | payment_status | next | Guidance gist |
|---|---|---|---|---|
| New user no pass | NEEDS_MONITORING_PASS | required | buy pass on 35958 | Free setup cannot activate without pass |
| Returning with pass id | PASS_ISSUED | recognized | confirm use / purchase | No second payment |
| Returning with continuation | resolve → ISSUED or PENDING | recognized/pending | resolve or setup | Never pay again |
| Payment pending | PAYMENT_SETTLEMENT_PENDING | pending | RESOLVE same continuation | Wait; auto-converge; no pay |
| Settled, pass issued | MONITORING_PASS_ISSUED | recognized | UNDERSTAND / confirm use | Pass ready; setup free |
| Duplicate paid empty re-entry after known continuation in body | never 402 | recognized/pending | continue setup | If body has continuation/pass, **must not** re-challenge |
| Invalid/used pass | PASS_NOT_REDEEMABLE | recognized | buy new only if truly used | Distinct from “pay again for pending” |
| Exact one candidate | show + confirm | — | candidate_id | User chooses |
| Multiple candidates | list diffs | — | candidate_id | User chooses |
| No safe candidate | NO_RELIABLE_MATCH | — | correct details / identity | Fail closed |
| Wrong seller / Target Plus / wrong variant | reject | — | rediscover | Fail closed |
| Expired discovery | session expired | — | rediscover | |
| Bad/expired code | EMAIL_NOT_VERIFIED | — | retry or re-begin | |
| Consent declined | blocked | — | explain both required | No activation |
| Ineligible | policy status | — | explain Target rules | No activation |
| Provider timeout | truthful pending/degraded | — | resume same journey | No fake data |
| Interrupted / repeat | resume durable state | — | same next field | Idempotent |
| Active monitoring | MONITORING_ACTIVE | recognized | status / wait | No guarantee |
| No price drop | observation recorded | — | wait | |
| Valid price drop | alert once | — | Target instructions | Target decides |
| Stop | STOPPED | — | history kept | No refund claim |

---

## 5. Settlement → pass convergence (core repair)

### Goal

A settled payment produces **exactly one** Monitoring Pass **automatically** without owner intervention. A continuation request **reconciles that settlement before any new payment challenge**.

### Mechanism (layered)

1. **Same-request bounded poll (hot path)**  
   After OKX settle returns `pending` + tx hash:  
   - Store verifying row + continuation immediately.  
   - Poll `GET settle/status` up to **N=3** times with short delays totaling **≤ ~2.5 s** wall budget.  
   - If success → mark settled → issue pass → return `MONITORING_PASS_ISSUED`.  
   - If still pending → return `PAYMENT_SETTLEMENT_PENDING` with continuation, `second_payment_required: false`, `retry_safe: true`.

2. **Continuation-targeted reconcile (never full-table thrash)**  
   `RESOLVE_MONITORING_PASS` and marketplace journey entry with continuation:  
   - Load continuation → payment row only.  
   - Call `confirmPendingPassPayment` for **that payment**.  
   - Do **not** scan 50 unrelated verifying payments on the user hot path.

3. **Paid endpoint re-entry policy**  
   - Empty / no auth header → 402 (first buy) **only if** body does not carry pass/continuation/journey keys.  
   - Body with `pass_continuation_id` / `monitoring_pass_id` / `journey_id` → **journey/resolve path**, never 402.  
   - Optional: if header present and already settled for digest → return issued (existing).

4. **Background automatic recovery**  
   - Add Vercel Cron (or documented `vercel.json` crons) hitting  
     `POST /v1/owner/pass-settlement-reconcile` on a short interval (e.g. 1–5 min) with `CRON_SECRET`.  
   - Owner manual call remains **emergency fallback only**.

5. **Idempotency**  
   - UNIQUE `settlement_ref` → one pass.  
   - Reconcile/replay concurrent-safe.  
   - Never call verify/settle again on reconcile (status only).

### Explicit non-goals

- Do not manually edit Production payment/pass rows.  
- Do not invent settlement refs.  
- Do not accept caller-supplied settlement hashes as authority without OKX status confirmation (except already-stored opaque ref).

---

## 6. Unified conversation layer

### Single response builder

Add a small module (e.g. `src/a2mcp/conversation-contract.ts`) that:

- Builds the contract object from state.  
- Is used by marketplace journey, resolve responses, paid pending/issued bodies, and free journey field attachment.

### Free first contact (marketplace)

Replace pass-id-only first contact with a response that:

- Introduces Nobu.  
- Explains free Purchase Setup vs paid Monitoring Pass.  
- Sets `payment_status: required` if no pass, with clear next: use service 35958 **or** provide `monitoring_pass_id` / `pass_continuation_id` if already purchased.  
- Still exposes Onchain OS `fields`/`requiredArgs` that allow **either** pass handoff **or** explicit “I need a pass” routing without inventing payment on the free endpoint.

Recommended machine shape:

```json
{
  "status": "input_required",
  "completed_step": "NOBU_INTRODUCED",
  "payment_status": "required",
  "second_payment_required": false,
  "monitoring_active": false,
  "journey_complete": false,
  "retry_safe": true,
  "fields": ["monitoring_pass_id"],
  "requiredArgs": ["monitoring_pass_id"],
  "message": "…",
  "guidance": "If the user has no pass, route them to service 35958 (Nobu Monitoring Pass, 0.99 USDT) once. If they already paid, send monitoring_pass_id or pass_continuation_id here. Purchase Setup never charges."
}
```

(Accept optional `pass_continuation_id` as alternate field in journey entry — already supported.)

### Marketplace journey stages

Keep stages; enrich every `incomplete`/`complete` with full contract.  
One focused question per response (already mostly true).

---

## 7. Latency design

| Class | Target p95 | Strategy |
|---|---|---|
| Guidance / validation / status / resume | < 2 s | Pure JSON + single keyed DB reads; no Groq/SerpApi |
| DB-only transitions | < 2 s | Existing 5s/8s pool bounds; no multi-row scans |
| Payment challenge | < 3 s | Challenge build only (already) |
| Email code send | < 5 s | Existing Resend path; fail closed |
| Product discovery | < 10 s useful **or** resumable pending | Cap SerpApi wait; if over budget return DISCOVERY_PENDING + session/journey id |
| Paid settle path | challenge < 3 s; settle+poll ≤ ~5–6 s total or pending resume | Bounded poll budget |
| A2A tasks | accept promptly; complete << 30 min | Fast first response; never hang without pending state |

**Rules:**

- Strict external timeouts; bounded retries (e.g. 1–2) only when safe/idempotent.  
- No unbounded polling loops.  
- Slow work returns truthful pending + durable resume ids.  
- Do not weaken matching/policy for speed.

---

## 8. Observability

Structured logs (existing request log) must always include:

- route, method, recognised action/journey stage  
- status, duration_ms  
- payment_status class (never raw headers)  
- external call timings: okx_verify_ms, okx_settle_ms, okx_status_ms, db_ms, serpapi_ms, groq_ms when applicable  
- clientDisconnected  

Never log: PAYMENT-SIGNATURE, OTP, connection_token, API secrets, raw settlement material beyond internal ops.

---

## 9. Safety locks (non-negotiable)

- One charge / one pass per settlement  
- One activation per eligible journey  
- No second payment for settled/recoverable attempt  
- No monitoring before full gate chain  
- Target-only, no Target Plus, fail-closed matching  
- No cross-user access  
- No caller-controlled ownership or idempotency keys  
- No secrets in logs  
- Idempotent monitoring/alerts; stopped monitors excluded  
- No false price-drop alerts  

---

## 10. Implementation change map (coordinated set)

| Area | Files (expected) |
|---|---|
| Conversation contract | new `src/a2mcp/conversation-contract.ts`; wire `journey.ts`, `marketplace-journey.ts`, `monitoring-pass-service.ts` |
| Settlement hot-path poll | `monitoring-pass-service.ts`, possibly `okx-seller-client.ts` |
| Targeted resolve reconcile | `monitoring-pass-service.ts` resolve path |
| Paid re-entry | `app/v1/agent/monitoring-pass/route.ts` |
| Free first contact | `marketplace-journey.ts` + free route |
| Cron | `vercel.json` for pass-settlement-reconcile (+ monitor scheduler if safe) |
| Tests | expand `tests/payments/monitoring-pass.test.ts`; marketplace journey tests; conversation contract tests |
| Docs | current-state, build-order, architecture, test plan, payment arch, threat model notes, OpenAPI if response fields expand |
| Proof | this directory |

---

## 11. Proof plan (minimum sufficient)

1. Focused unit/integration tests for every modified subsystem  
2. One integration suite: state machine, contract, payment convergence, retries, resume, concurrency, ownership, timeouts  
3. Typecheck  
4. Production build  
5. Limited secret scan  
6. Deploy + alias  
7. Production probes: health, free, unpaid paid, settlement recovery, resume, monitoring/stop as available  
8. Official Onchain OS/A2A readiness (daemon start if needed; no ASP mutation)  
9. Recover/confirm existing payment via **normal** resolve (not manual DB edit) — already ISSUED; re-prove  
10. One complete real OKX.AI User-role journey  
11. At most one new 0.99 payment for final proof, only after non-paid proof  

---

## 12. Design freeze

Implementation may begin only after this file and `01-audit.md` exist (this commit of docs).  
Final closeout requires one intentional commit with code + tests + docs + proof and a single verdict:

- `NOBU_COMPLETE_PRODUCTION_HARDENING_PASS` or  
- `NOBU_COMPLETE_PRODUCTION_HARDENING_BLOCKED_<REASON>`
