# Complete Production Hardening — Baseline

**Date:** 2026-07-28  
**Lane:** Nobu Complete Production Audit, Redesign and Hardening  
**Starting HEAD:** `f9f1b2575d2a865a3bb67962452a72bc6afb610d`  
**Branch:** `master` (tracks `origin/master`)  
**Worktree:** `C:\Users\dtwof\Desktop\AfterBuy` (clean at start)

## Live production

| Item | Value |
|---|---|
| Canonical alias | `https://usenobu.vercel.app` |
| Deployment | `dpl_BE7Ki6KGMEhdpSsxo4pUSYewJBAd` |
| Deployment host | `usenobu-cf3hbavti-dtwoflicks-2878s-projects.vercel.app` |
| Age at audit | ~2 days (created 2026-07-27) |
| Also aliased | `usenobu.xyz`, `www.usenobu.xyz` |
| Health | HTTP 200, `status: ok`, SerpApi + Groq configured |

## ASP #5541 (live readback 2026-07-28)

| Item | Value |
|---|---|
| Agent ID | `5541` |
| Name | Nobu |
| Role | ASP |
| Owner wallet | `0xc07a6f80640ceac1fcc20b31ccf672b58eedd938` |
| Online | `onlineStatus: 1` |
| Marketplace | **Listed — eligible for task recommendations** (`approvalDisplayStatus: 4`) |
| Sales count | 3 |
| Free service | `33561` — Nobu Purchase Setup — fee `0` — `https://usenobu.vercel.app/v1/agent` |
| Paid service | `35958` — Nobu Monitoring Pass — fee `0.99` — `https://usenobu.vercel.app/v1/agent/monitoring-pass` |

**Supersedes** prior “rejected / not listed” claims in older current-state notes. ASP identity, wallet, service IDs, endpoints and price are **locked** for this lane (no create/update).

## A2A runtime (local operator machine)

| Item | Value |
|---|---|
| Onchain OS | `4.4.0` at `C:\Users\dtwof\.local\bin\onchainos.exe` |
| `@okxweb3/a2a-node` | `0.1.10` (global) |
| `okx-a2a doctor` | `ready: false` — **daemon not running** (blocker) |
| Autostart | not installed (optional) |
| WSL | default v2; `Ubuntu` available and enterable (`ubuntu-ok`); `docker-desktop` also present |

## Authoritative live payment evidence

| Field | Value |
|---|---|
| Amount | `0.99 USDT` on X Layer |
| Transaction | `0xead9f6bade3daa2fa27c826bc0bd7853b4ddd9683295e25858b5f5f6b81edf23` |
| Continuation | `pass_cont_2adcc866e68b4ed58f6e2bbe9fba3b27` |
| User-observed failure | Pass not issued automatically; flow still requested payment; long response times |

### Production resolve of that continuation (audit probe)

```
POST /v1/agent {"action":"RESOLVE_MONITORING_PASS","pass_continuation_id":"pass_cont_2adcc866e68b4ed58f6e2bbe9fba3b27"}
→ 200 MONITORING_PASS_ISSUED
  monitoring_pass_id: pass_33539591e6fc486ba5bcdd2169c78c31
  pass_status: issued
  second_payment_required: false
  next_action: UNDERSTAND_PURCHASE
  ~578–1210 ms
```

Interpretation: durable recovery eventually issued the pass (owner reconcile and/or later resolve). **Marketplace did not deliver automatic issuance at payment time.** Real marketplace behavior remains stronger evidence than isolated PASS rows.

## Latency baseline (Production, 2026-07-28)

| Step | HTTP | Observed ms | Notes |
|---|---|---|---|
| `/health` | 200 | 1402–2138 | cold-ish |
| Free GET/POST empty | 400 `input_required` | 463–620 | warm path |
| Paid GET/POST empty | 402 `PAYMENT_PENDING` | 630–851 | challenge only |
| `RESOLVE_MONITORING_PASS` (continuation) | 200 issued | 578–1210 | may hit DB + optional reconcile |
| Free journey with pass/continuation | 400 `confirm_use_pass` | 473–508 | good guidance |
| Paid POST with continuation body | 400 `confirm_use_pass` | 508 | **does not re-challenge** when body carries continuation |

## Mandatory docs read

- `AGENTS.md`
- `docs/nobu-current-state.md`
- `docs/nobu-build-order.md`
- `docs/nobu-architecture.md`
- `docs/nobu-test-and-proof-plan.md`
- `docs/nobu-okx-agent-native-paid-monitoring-architecture.md` (partial; product model partially stale vs Monitoring Pass-first)
- Payment, journey, free agent, auth-store, OpenAPI surfaces inspected in code

## Hard locks for this lane

- Do not change Agent 5541, owner wallet, service IDs, endpoints, or price
- Do not create another ASP
- Do not manually edit Production payment/pass rows
- Do not broaden beyond Target
- Do not claim PASS from mocks/curl alone
- No second live payment until non-paid proof passes; at most one new `0.99` for final proof
