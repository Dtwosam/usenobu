# Complete Speed and Flow Hardening — Baseline

**Date:** 2026-07-28  
**Starting HEAD:** `6ac1bf01d6f6e06a31c3af69ef75e742e033c262`  
**Prior lane:** Complete production hardening (`docs/proof/complete-production-hardening/`) — settlement→pass and conversation contract code deployed; real A→Z not closed.  
**This lane:** Final coordinated speed + conversation flow hardening for a fresh OKX.AI demo recording.

## Live platform truth at start

| Item | Value |
|---|---|
| ASP | `#5541` Nobu — listed (`approvalDisplayStatus: 4`) |
| Services | `33561` free Purchase Setup; `35958` Monitoring Pass `0.99` |
| Production | `https://usenobu.vercel.app` → `dpl_EeL4uL1GmtfYeR6VFYW67gWHVr7y` |
| A2A doctor | daemon **not running** at audit start (`okx-a2a doctor` 1 fail) |
| Onchain OS | `4.4.0` |

## Authoritative latest User evidence (pre-payment)

Source: `docs/proof/complete-production-hardening/03-live-payment-preconfirm.md`

| Metric | Observed |
|---|---|
| User-visible time to payment confirmation | **4 min 54 s** |
| `payment quote` count | **3** |
| Distinct `pay_*` IDs | **3** (`pay_f5e63f…`, `pay_ffd21c…`, `pay_d77c57…`) |
| `walletError` | `balance_unavailable` on all three |
| Payment authorized | **no** |
| Nobu unpaid 402 (this session probes) | ~0.35–0.54 s warm; historical ~0.5–1.5 s |
| Funds moved | none |

## Production latency probes at audit (2026-07-28)

| Probe | HTTP | Wall ms |
|---|---|---|
| `GET /health` | 200 | 2190 |
| `POST /v1/agent` `{}` | 400 | 438 |
| `GET /v1/agent/monitoring-pass` | 402 | 357 |
| `POST /v1/agent/monitoring-pass` `{}` ×3 | 402 | 385 / 357 / 369 |

**Conclusion:** Nobu endpoints are already inside multi-second budgets when warm. The multi-minute failure is **not** explained by merchant HTTP alone.

## Rule

Audit (`01-audit.md`) and design (`02-design.md`) must exist and freeze before any implementation in this lane. Final PASS requires a real OKX.AI A→Z journey after a non-paid rehearsal gate.
