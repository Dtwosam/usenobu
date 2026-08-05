# Nobu Complete Production Hardening — Proof

**Date:** 2026-07-28
**Starting HEAD:** `f9f1b2575d2a865a3bb67962452a72bc6afb610d`
**Ending HEAD / closeout commit:** `ef2eabc678d575bb4b4251c55aeb5da6e3fb17c0`
**Production deploy:** `dpl_EeL4uL1GmtfYeR6VFYW67gWHVr7y` (`usenobu-i58dclmaf…`)
**Alias:** `https://www.usenobu.xyz` explicitly re-aliased
**Verdict:** `NOBU_COMPLETE_PRODUCTION_HARDENING_BLOCKED_REAL_OKX_USER_JOURNEY_INCOMPLETE`

## Why not PASS

Hard acceptance requires **one complete real OKX.AI User-role conversation** proving payment→pass→setup→email→consent→activation→check→alert→status→stop with no owner intervention. This lane:

- audited and designed first (see `00-baseline.md`, `01-audit.md`, `02-design.md`);
- repaired the confirmed settlement / conversation / latency defects as one change set;
- proved locally and with Production probes;
- recovered the existing real payment via the **normal** free resolve path (not DB edit);
- started A2A daemon (`ready: true`);

but did **not** complete a full interactive OKX.AI marketplace conversation with a new live payment, email OTP, monitoring activation, live alert, and stop. Per hard locks, mocks/curl/partial proof cannot claim PASS. **No new live payment was made** (non-paid proof first; at most one new payment reserved for final journey).

## Baseline (audit)

| Item | Value |
|---|---|
| ASP `#5541` | Listed (`approvalDisplayStatus: 4`), online, services `33561` / `35958` |
| Authoritative payment | tx `0xead9f6ba…edf23`, continuation `pass_cont_2adcc866…` |
| Pre-repair failure | Pass not auto-issued; payment re-requested; long waits |
| Post-repair resolve | `MONITORING_PASS_ISSUED` → `pass_33539591e6fc486ba5bcdd2169c78c31` |

## Root causes repaired

| ID | Repair |
|---|---|
| RC-PAY-1/4 | Bounded same-request settle/status poll after pending (≤ ~2.5 s) |
| RC-PAY-2 | Journey/continuation body on paid URL never re-issues 402 |
| RC-PAY-3 | Targeted confirm-by-payment-id on RESOLVE; daily cron backup (Hobby) |
| RC-LAT-3 | RESOLVE no longer scans up to 50 unrelated payments |
| RC-UX-1/3 | Conversation contract on pass + marketplace journey responses |
| RC-UX-2 | Free first contact restored to full service descriptor (both services explained) |
| RC-LAT-4 | `vercel.json` crons for reconcile + monitor (daily on Hobby plan) |
| RC-A2A-1 | A2A daemon started; doctor `ready: true` |

## Latency (Production after deploy)

| Step | Before (audit) | After (probe) |
|---|---|---|
| Health | 1402–2138 ms | ~1876 ms cold |
| Free empty | 463–620 ms | ~590–802 ms |
| Paid empty 402 | 630–851 ms | ~527 ms |
| RESOLVE issued continuation | 578–1210 ms | ~726–1055 ms |
| Journey with continuation | 473–508 ms | ~772 ms |

All simple paths remain under multi-second budgets when warm; discovery/Groq not re-timed on Production in this lane.

## Tests

| Suite | Result |
|---|---|
| `tests/payments/monitoring-pass.test.ts` | 27/27 |
| `tests/payments/*` | 54/54 |
| `tests/a2mcp/conversation-contract.test.ts` | 3/3 |
| `tests/a2mcp/marketplace-journey.test.ts` | 3/3 |
| `tests/a2mcp/free-agent-validation.test.ts` | 5/5 |
| `npx tsc --noEmit` | pass |
| `npx next build` | pass |
| Limited secret scan | clean (only banned-field name `private_key` in rejection list) |

## Production probes (post-deploy)

| Probe | Result |
|---|---|
| Health | 200 ok |
| Free `{}` | 400 `SERVICE_INPUT` / introduction of both services |
| Paid `{}` | 402 `PAYMENT_PENDING`, `payment_status=required`, `second_payment_required=false` |
| RESOLVE continuation | 200 ISSUED, `payment_status=recognized`, pass `pass_33539591…` |
| Paid POST with continuation | 400 confirm_use_pass, **not** 402 |
| Official `x402-check` paid | `valid: true` |
| Official free check | `inputRequired: true` (expected free, not 402) |
| A2A doctor | `ready: true`, daemon pid running |

## Charge / pass / journey / activation counts (this lane)

| Metric | Count |
|---|---|
| New live payments | **0** |
| New Production pass rows created by this lane | **0** (existing pass re-proven) |
| Owner DB edits | **0** |
| ASP mutations | **0** |

## Files changed (implementation)

- `src/a2mcp/conversation-contract.ts` (new)
- `src/a2mcp/marketplace-journey.ts`
- `src/a2mcp/service-descriptor.ts`
- `src/payments/monitoring-pass-service.ts`
- `src/auth/auth-store.ts` (`getMonitoringPassPaymentById`)
- `app/v1/agent/route.ts`
- `app/v1/owner/pass-settlement-reconcile/route.ts` (GET for cron)
- `app/v1/owner/monitor-scheduler/route.ts` (GET for cron)
- `vercel.json`
- tests under `tests/payments/`, `tests/a2mcp/`
- docs + this proof directory

## Remaining blockers for PASS

1. **Complete real OKX.AI User-role A→Z conversation** (discover → pay once → automatic pass → setup → email → consent → activate → check → alert → status → stop).
2. Optionally raise Vercel plan if sub-daily settlement cron is required (Hobby allows **daily** only; hot-path poll + RESOLVE cover normal convergence).
3. Optional A2A autostart (admin PowerShell) — not blocking while daemon is running.

## Exact next step

Run one interactive User-role journey on OKX.AI against agent `5541` **without** owner reconcile. Use at most one new `0.99 USDT` payment. If that journey passes all acceptance bullets, re-open this proof and flip verdict to `NOBU_COMPLETE_PRODUCTION_HARDENING_PASS`.
