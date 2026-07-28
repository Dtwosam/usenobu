# Complete Speed and Flow Hardening — Design

**Date:** 2026-07-28  
**Depends on:** `01-audit.md`  
**Rule:** One coordinated change set. No symptom-only micro-lanes.

---

## 1. Canonical product journey (server-owned)

```
INTRO (free) ──► BUY_PASS (paid 35958, once)
                     │
                     ▼
              PAYMENT_PENDING (402 + one quote policy)
                     │  user authorizes at most one pay_*
                     ▼
              PAYMENT_SUBMITTED (pending settle) ──► RESOLVE same continuation
                     │
                     ▼
              PASS_ISSUED (second_payment_required=false)
                     │
                     ▼
              CONFIRM_USE_PASS
                     │
                     ▼
              PURCHASE_DESCRIPTION (extract only — one focused ask)
                     │
                     ▼
              PRODUCT_DISCOVERY (SerpApi; resume via journey_id)
                     │
                     ▼
              CANDIDATE_ID (user exact select only)
                     │
                     ▼
              EMAIL → CODE → CONSENTS → PREFLIGHT → REDEEM
                     │
                     ▼
              MONITORING_ACTIVE → status / alert / stop
```

**Rules users always hear (once, short):**

1. Purchase Setup is free.  
2. Monitoring Pass is **0.99 USDT** once.  
3. Paying does **not** start monitoring.  
4. Never pay again after settlement or while settlement is pending.  
5. Target decides any adjustment; Nobu never guarantees refunds/savings.

---

## 2. Conversation contract (required on every Nobu-controlled response)

| Field | Required |
|---|---|
| `status` | yes |
| `completed_step` | yes |
| `next_action` | yes |
| `required_user_input` | yes (null when complete) |
| `fields` / `requiredArgs` | yes when input needed |
| `message` | short user truth |
| `guidance` | short agent instruction |
| `payment_status` | `not_required` \| `required` \| `pending` \| `recognized` |
| `second_payment_required` | boolean (false after settlement known) |
| `monitoring_active` | boolean |
| `journey_complete` | boolean |
| `retry_safe` | boolean |
| IDs | `journey_id` / `pass_continuation_id` / `monitoring_pass_id` when known |

### Payment-path **additional** machine fields (unpaid 402)

| Field | Value / meaning |
|---|---|
| `quote_policy` | `single_deliberate_attempt` |
| `one_quote_only` | `true` |
| `reuse_payment_id_until` | `expired_or_conclusive_failure` |
| `do_not_re_quote_on` | `["balance_unavailable","insufficient_balance","payment_pending"]` |
| `wallet_preflight_blocker` | Present when client should **stop** and fix wallet rather than re-quote: message that `balance_unavailable` is not a signal to create a new quote |

These fields do not change x402 wire format (header + accepts). They only shape the JSON body so calling agents can stop thrashing.

### Conversation style

- Short direct `message` (1–3 sentences).  
- One focused next field set.  
- Never re-ask stored journey fields.  
- Never issue 402 when body carries recognized pass / pending continuation / journey keys.  
- Distinguish: payment required vs pending vs recognized; setup incomplete vs monitoring active.  
- Never guarantee Target adjustment.

---

## 3. One-quote payment policy (Nobu + documented OKX limits)

### Nobu guarantees

1. Unpaid empty paid endpoint → **exactly one challenge shape** (stable amount/network/asset/payTo).  
2. Body never invites a second charge (`second_payment_required: false` always on this product).  
3. After PAYMENT-SIGNATURE with pending settle → continuation + never re-charge.  
4. After issued pass → free setup; paid URL with journey keys never 402.

### Nobu cannot prevent

- OKX client creating multiple local `pay_*` records if the agent re-runs `payment quote`.  
- Wallet `balance_unavailable` opacity.

### Designed user path around platform limit

1. Deliberate “buy Monitoring Pass” once.  
2. One quote → one current `pay_*`.  
3. If `walletError: balance_unavailable`: **stop**, fix wallet sign-in / X Layer USD₮0 / RPC; **do not re-quote**.  
4. If `login_required`: sign in, then **one** re-quote (platform rule).  
5. Authorize **only the latest current** payment id once.  
6. After pay: keep continuation; RESOLVE if pending; never new quote.

Rehearsal gate enforces: one quote, no `balance_unavailable`, acceptable timing, no owner DB edit.

---

## 4. Marketplace stage machine (repair)

### New / adjusted stages

| Stage | Input | Work | Output |
|---|---|---|---|
| `confirm_use_pass` | `confirm_use_pass=true` | DB only | next purchase_description |
| `purchase_description` | purchase text | **Extract only** (bounded Groq + deterministic fallback) | store `purchase_snapshot_json`; stage → `product_discovery` |
| `product_discovery` | `journey_id` (optional re-description) | **SerpApi discovery only** (bounded) | candidates → `candidate_id`, or clear no-match / retry_safe pending |
| `candidate_id` | user `candidate_id` | confirm fail-closed | email |
| `email` / `verification_code` / `consents` | as today | as today | redeem → active |

### Durable field

- Add `purchase_snapshot_json` on `marketplace_purchase_journeys` (schema patch + AuthStore).  
- Never log raw OTP/secrets; snapshot is structured purchase fields only.

### Why split

- Removes silent extract+discover wall clock.  
- Each response returns under budgets more often.  
- Agent always has a clear next_action and journey_id to resume without re-asking purchase details.

---

## 5. Latency budgets (acceptance)

| Step | Target | Strategy |
|---|---|---|
| First useful Nobu ack (warm) | < 2 s | Pure free/paid first contact; no DB/AI |
| Guidance / status / resume | p95 < 2 s | Keyed DB only |
| Payment challenge | < 3 s | Pure challenge build (already) |
| Quotes per deliberate pay | **1** | Guidance + machine quote_policy; rehearsal gate |
| Payment-to-pass | Immediate if settled; else pending + resume | Prior poll + RESOLVE |
| Email initiation | < 5 s | Existing provider; fail closed |
| Product discovery | Result or pending ≤ 10 s | Bound SerpApi (~8–10 s); stage split |
| Unexplained wait | never > 3 s without status | Intermediate stage responses |
| Full journey | << 30 min OKX limit | Clear short path |

Marketplace Groq: prefer ≤ ~8 s timeout then deterministic extract.  
Marketplace SerpApi: prefer ≤ ~10 s timeout; on failure return retry_safe discovery incomplete (no fake products).

---

## 6. Implementation map (single change set)

| Area | Files |
|---|---|
| 402 one-quote contract | `src/payments/monitoring-pass-service.ts` (`monitoringPassResponseBody`) |
| Free full contract + shorter intro | `src/a2mcp/service-descriptor.ts` |
| Journey stages + split | `src/a2mcp/marketplace-journey.ts`, `conversation-contract.ts` |
| Snapshot column | `src/auth/durable-schema.ts`, `src/auth/auth-store.ts` |
| Optional bound timeouts on marketplace deps | journey call sites / understand deps / discover |
| Tests | `tests/a2mcp/*`, `tests/payments/monitoring-pass.test.ts` as needed |
| Proof + state docs | this directory; `nobu-current-state.md`; `nobu-build-order.md` |

Non-goals: ASP mutation, price change, matching looseness, owner DB edits, new retailer.

---

## 7. Verification plan

1. Focused tests for contract, 402 quote policy, journey stage split, resume.  
2. Existing payment concurrency / replay tests still green.  
3. Typecheck + production build + limited secret scan.  
4. Deploy + alias.  
5. Production non-paid probes (latency).  
6. A2A ready.  
7. **Non-paid rehearsal** to payment confirmation only → `READY_FOR_FAST_FRESH_VIDEO_RECORDING` or `NOBU_VIDEO_FLOW_BLOCKED_<REASON>`.  
8. One real paid A→Z if rehearsal passes (at most one 0.99; never retry pay).

---

## 8. Verdicts

- Hardening close: `NOBU_COMPLETE_SPEED_AND_FLOW_HARDENING_PASS` or `NOBU_COMPLETE_SPEED_AND_FLOW_HARDENING_BLOCKED_<REASON>`.  
- Video gate: `READY_FOR_FAST_FRESH_VIDEO_RECORDING` or `NOBU_VIDEO_FLOW_BLOCKED_<REASON>`.  
- PASS requires real fast smooth A→Z, one quote, one payment, auto pass, clear guidance, correct monitoring, no normal owner intervention.

---

## 9. Design freeze

Audit + this design are recorded. Implementation may begin as one coordinated set only.
