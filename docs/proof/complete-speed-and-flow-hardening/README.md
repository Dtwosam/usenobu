# Nobu Complete Speed and Flow Hardening — Proof

**Date:** 2026-07-28  
**Starting HEAD:** `6ac1bf01d6f6e06a31c3af69ef75e742e033c262`  
**Ending HEAD / commit:** `0541a6efaf9f437a6e87dca67df0f727b857675e`  
**Production deploy:** `dpl_E6xegDEY2eTCsBFCHtEsacDcdo9b` (`usenobu-jsd3udipq`)  
**Alias:** `https://usenobu.vercel.app` explicitly re-aliased  
**ASP:** `#5541` unchanged; services `33561` / `35958` unchanged; price `0.99` unchanged  

## Verdict

**Code + deploy + non-paid payment-confirmation rehearsal: PASS**  
**Complete real OKX.AI A→Z journey: NOT CLOSED**

Final lane verdict:

`NOBU_COMPLETE_SPEED_AND_FLOW_HARDENING_BLOCKED_REAL_OKX_USER_JOURNEY_INCOMPLETE`

Video gate:

`READY_FOR_FAST_FRESH_VIDEO_RECORDING`

---

## Why READY for video (non-paid rehearsal)

Official Path A non-paid rehearsal against Production:

| Check | Result |
|---|---|
| A2A doctor | `ready` — daemon pid running, 8 pass / 0 fail |
| Wallet | signed in (`loggedIn: true`) |
| Balance preflight | `hasBalance: true` (no `balance_unavailable`) |
| Quote count | **1** |
| Payment ID | `pay_92037700c330a3c7ddd24f94` only |
| Quote wall time | **3179 ms** |
| Merchant body | `one_quote_only: true`, `quote_policy: single_deliberate_attempt`, `do_not_re_quote_on` includes `balance_unavailable` |
| Funds moved | **none** (stopped at confirm) |
| Owner DB edit | **none** |
| ASP mutation | **none** |

Operator next: record User-role journey; authorize **at most one** pay against the **current** payment id only if a fresh quote is taken at record time (TTL ~300 s). Prefer one new quote immediately before record if the rehearsal id expired.

---

## Why not full HARDENING PASS

Hard acceptance requires one complete interactive OKX.AI User conversation proving:

discover → one quote → one payment → auto pass → free setup → discovery → exact confirm → email → consents → activate → status/alert → stop

This lane closed code + deploy + non-paid confirm-screen rehearsal. It did **not** authorize a live payment or complete post-pay A→Z in OKX.AI chat.

---

## Root-cause inventory (summary)

See `01-audit.md`. Primary latest failure (4m54s, 3 quotes, `balance_unavailable`) was **OKX client orchestration + wallet preflight**, not Nobu HTTP (402 already ~0.4–1.5 s).

| Class | IDs |
|---|---|
| Nobu repaired this lane | RC-SF-GUIDE-1/2/3, RC-SF-ORCH-1/2, RC-SF-A2A-1 |
| Prior hardening (kept) | RC-PAY settlement/continuation |
| Platform / env | RC-OKX-QUOTE-*, RC-OKX-ORCH-1, RC-ENV-WALLET-1 |

---

## Repairs shipped

1. **402 one-quote machine policy** — `one_quote_only`, `quote_policy`, `do_not_re_quote_on`, `wallet_preflight_blocker`, short guidance.  
2. **Free first contact full contract** — `payment_status`, `second_payment_required`, `retry_safe` + shorter dual-service intro.  
3. **Marketplace stage split** — extract → durable `purchase_snapshot_json` → `product_discovery` resume via `journey_id` (no silent extract+SerpApi stack).  
4. **Conversation contract** stage `product_discovery`.  
5. **A2A daemon** started for proof readiness.

---

## Latency (Production after alias)

| Step | Observed |
|---|---|
| Health | ~1.6 s (this session) |
| Free `{}` warm | ~0.5–1.2 s |
| Paid `{}` 402 warm | ~0.5–0.8 s |
| Official `payment quote` ×1 | **3.2 s** end-to-end CLI |
| Paid sequential empty ×3 (HTTP only) | ~0.5 s each (no client re-quote) |

---

## Tests

| Suite | Result |
|---|---|
| `tests/a2mcp/conversation-contract.test.ts` | 4/4 |
| `tests/a2mcp/free-agent-validation.test.ts` | 5/5 |
| `tests/a2mcp/marketplace-journey.test.ts` | 3/3 |
| `tests/payments/*` (all) | 54/54 |
| Combined focused | **66/66** |
| `npx tsc --noEmit` | pass |
| `npx next build` | pass |
| Official `x402-check` paid | `valid: true` |
| Limited secret scan | clean (field names only) |

---

## Counts this lane

| Metric | Count |
|---|---|
| New live payments authorized | **0** |
| Payment quotes (rehearsal) | **1** |
| Pass / activation rows created by this lane | **0** |
| Owner Production DB edits | **0** |
| ASP mutations | **0** |

---

## Files changed

- `src/payments/monitoring-pass-service.ts`
- `src/a2mcp/service-descriptor.ts`
- `src/a2mcp/conversation-contract.ts`
- `src/a2mcp/marketplace-journey.ts`
- `src/auth/durable-schema.ts`
- `src/auth/auth-store.ts`
- `tests/a2mcp/*`, `tests/payments/monitoring-pass.test.ts`
- `docs/proof/complete-speed-and-flow-hardening/*`
- `docs/nobu-current-state.md`, `docs/nobu-build-order.md`

---

## Remaining platform limitations

1. OKX User agents can still re-invoke `payment quote` despite merchant `one_quote_only` — Nobu cannot delete client-side thrash.  
2. ASP/provider A2A wake can add tens of seconds before first merchant call.  
3. Multi-turn OKX reasoning time is outside Nobu process budget.  
4. Vercel Hobby cron interval remains daily; hot-path poll + RESOLVE remain primary settlement convergence.

---

## Exact next step for PASS

1. Keep A2A daemon running (`okx-a2a daemon start` if needed).  
2. Record one OKX.AI User journey on agent `5541`.  
3. One deliberate Monitoring Pass request → **one** quote → confirm wallet (`hasBalance`) → **one** `payment pay` only.  
4. Prove auto pass, free setup stages (including discovery resume), email, consents, activate, status, stop.  
5. Flip verdict only if all A→Z bullets pass without owner DB edit or second payment.
