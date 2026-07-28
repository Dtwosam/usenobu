# Complete Speed and Flow Hardening — Audit

**Date:** 2026-07-28  
**Starting HEAD:** `6ac1bf01d6f6e06a31c3af69ef75e742e033c262`  
**Method:** Prior hardening audit + live pre-confirm evidence + Production latency probes + code path tracing of free/paid/marketplace journey  
**Metric rule:** User-visible total time is the product metric. Endpoint speed alone is never “fast.”

---

## 1. End-to-end stage map (user-visible)

| # | Stage | Surface | Expected UX | Observed / code truth | Controllable by |
|---|---|---|---|---|---|
| 1 | Discover Nobu | OKX marketplace | Listed; clear services | Listed `#5541`; services `33561`/`35958` | Platform listing + ASP copy (locked) |
| 2 | First message | Free `/v1/agent` or task accept | Under 2 s useful ack; both services explained once | Free pure 400/READY ~0.4–0.8 s warm; health cold ~2 s; **ASP wake can be ~48 s** (prior job) | Nobu response content; OKX task/A2A wake |
| 3 | Understand services | Free descriptor / first contact | One short explanation; free vs 0.99; pass ≠ activation | Descriptor long; dual models (action enum vs marketplace keys); free first contact still `action`-centric | **Nobu** |
| 4 | Deliberate pay intent | User chooses Monitoring Pass | One quote only | **3 quotes** in latest attempt | OKX agent orchestration (**primary**); Nobu guidance (**secondary**) |
| 5 | Payment challenge | Paid `/v1/agent/monitoring-pass` | Under 3 s challenge | Nobu 402 **~0.35–1.5 s**; OKX `payment quote` CLI historically **~5 s** each | Nobu HTTP; OKX quote CLI |
| 6 | Wallet preflight | Onchain OS local | Balance known or clear blocker | Repeated `walletError: balance_unavailable` | **OKX wallet / operator env** |
| 7 | Confirm pay UI | OKX.AI | Single confirm; no re-quote | Reached after **4m54s** and 3 IDs | OKX multi-turn + triple quote |
| 8 | Pay once | `payment pay --yes` once | One settlement | Not reached in latest evidence | Operator + OKX |
| 9 | Pass auto-issue | Paid replay / RESOLVE | Immediate or clear pending | Prior lane: hot-path poll + targeted RESOLVE; no full scan | **Nobu** (already repaired) |
| 10 | Free setup handoff | Free service / journey | Direct after pass; no re-pay | Paid body with continuation avoids 402; empty re-entry still 402 (correct for new buy) | **Nobu** + agent keeping IDs |
| 11 | Purchase details once | Journey / UNDERSTAND | One intake | Marketplace runs **extract + SerpApi discovery in one request** → silent multi-second wait | **Nobu** orchestration |
| 12 | Product discovery | DISCOVER / journey | Result or pending ≤10 s | SerpApi default 15 s; no marketplace pending stage | **Nobu** + SerpApi |
| 13 | Exact confirm | candidate_id | User-only lock; fail closed | Implemented | **Nobu** |
| 14 | Email verify | BEGIN/VERIFY | ≤5 s send; clear code prompt | Implemented Resend path | **Nobu** + email provider |
| 15 | Consents | dual true | Explicit both | Implemented | **Nobu** |
| 16 | Eligibility + redeem | preflight + redeem | Gates before consume | Implemented; marketplace trusted journey | **Nobu** |
| 17 | Monitoring active | status | Clear active | Implemented | **Nobu** |
| 18 | Check / alert | same pipeline | One valid alert; no false on provider fail | Implemented | **Nobu** |
| 19 | Status / resume | free + journey_id | After interrupt | Durable journey + continuation | **Nobu** |
| 20 | Stop | STOP_MONITORING | Stops schedule | Implemented | **Nobu** |

---

## 2. Latency attribution for latest 4m54s pre-confirm path

| Segment | Typical / observed | Owner |
|---|---|---|
| Nobu 402 challenge (×3 probes in quote path) | ~0.4–1.5 s each → **≤ ~5 s total** | Nobu |
| OKX `payment quote` per attempt (probe + wallet preflight + persist) | ~**5 s** × 3 ≈ **15 s** | OKX CLI |
| Skill load, multi-turn reasoning, re-quote decisions, UI waits | **Remainder ≈ 4+ minutes** | OKX.AI User agent / Onchain OS |
| ASP daemon wake (provider side, not buyer pay path) | ~48 s on one prior job | OKX A2A on provider machine |

**Nobu contribution to 4m54s is seconds, not minutes.** Product still fails the user-visible metric until quote cardinality and wallet preflight UX are safe.

---

## 3. Root-cause inventory

### A. Nobu-controlled defects (in scope for this lane)

| ID | Severity | Defect | Evidence |
|---|---|---|---|
| **RC-SF-GUIDE-1** | P0 | 402 body does not machine-forbid re-quote on wallet preflight opacity (`balance_unavailable`). Guidance says “pay once” but not “do not create another quote while balance is unavailable / reuse current payment ID.” | `monitoringPassResponseBody` PAYMENT_PENDING branch |
| **RC-SF-GUIDE-2** | P1 | Free first-contact / descriptor missing full conversation contract (`payment_status`, `second_payment_required`, `retry_safe`) on the pure free path agents hit first | `buildFreeServiceDescriptor` / `buildFreeServiceInputRequired` |
| **RC-SF-GUIDE-3** | P1 | Messages/guidance still long and multi-action; agents re-narrate and re-preflight | Descriptor + 402 guidance text length |
| **RC-SF-ORCH-1** | P0 | Marketplace `purchase_description` stage runs **Groq extract + SerpApi discovery in one HTTP request** with no intermediate response → unexplained multi-second (or tens of seconds) silence | `marketplace-journey.ts` lines ~289–348 |
| **RC-SF-ORCH-2** | P1 | No dedicated `product_discovery` stage / pending resume; discovery failure returns generic incomplete on purchase_description | same |
| **RC-SF-LAT-1** | P1 | Groq default timeout 20 s and SerpApi 15 s on user path can exceed “no unexplained wait >3 s” without a pending token | `groq-client.ts`, `serpapi/client.ts` |
| **RC-SF-LAT-2** | P2 | Cold health ~2 s; first contact OK warm; cold first useful ack can miss strict 2 s warm target after idle | Production probe |
| **RC-SF-A2A-1** | P1 | A2A daemon not running at audit start → task acceptance risk for demo | `okx-a2a doctor` |

### B. Already repaired (prior complete production hardening) — re-verify only

| ID | Status |
|---|---|
| RC-PAY-1/3/4 settlement pending auto-converge | Hot-path poll + targeted RESOLVE + daily cron |
| RC-PAY-2 re-402 with continuation body | Paid route routes marketplace body to journey |
| RC-LAT-3 full-table scan on resolve | Targeted `getMonitoringPassPaymentById` |
| RC-UX conversation contract on journey | `conversation-contract.ts` |

### C. OKX / Onchain OS client-controlled (document + design around; do not claim Nobu fix)

| ID | Behavior | Product impact |
|---|---|---|
| **RC-OKX-QUOTE-1** | User agent re-invokes `payment quote` on `walletError: balance_unavailable` (skill only re-quotes for `login_required`) | Multiple `pay_*` IDs; wasted minutes |
| **RC-OKX-QUOTE-2** | Each quote probes merchant for fresh 402 and creates a **new** local payment id | Cardinality >1 |
| **RC-OKX-ORCH-1** | Multi-turn skill load / reasoning dominates wall time | 4m54s to confirm |
| **RC-OKX-WAKE-1** | Provider A2A wake/playbook can take tens of seconds | Slow job accept (not pay path) |

### D. Operator environment

| ID | Behavior |
|---|---|
| **RC-ENV-WALLET-1** | `balance_unavailable` = balance lookup failed (not confirmed shortfall). Wallet must be signed in; X Layer USD₮0 ≥ 0.99; portfolio/RPC path healthy before `yes`. |
| **RC-ENV-A2A-1** | Daemon must stay running for proof (`okx-a2a daemon start` / doctor --fix). |

### E. Unavoidable external latency (bound + pending, never fake)

| Provider | Bound in code | User path rule |
|---|---|---|
| OKX verify/settle/status | Network + bounded poll ≤ ~2.5 s same-request | Else `PAYMENT_SETTLEMENT_PENDING` + continuation |
| Groq | 20 s class | Prefer shorter bound + deterministic fallback on marketplace |
| SerpApi | 15 s class | Bound + split stage / retry_safe pending |
| Resend email | Provider | Fail closed; clear message |
| Postgres | 5 s connect / 8 s statement | Keyed reads only on user path |

---

## 4. Causes of each named failure mode

| Failure mode | Primary cause | Secondary |
|---|---|---|
| Slow first response | Cold start / A2A wake | Long first-contact payload |
| Repeated skill load / preflight | OKX agent turns | Verbose multi-action Nobu guidance |
| Repeated payment quotes | OKX re-quote after `balance_unavailable` | Nobu 402 does not encode one-quote / wallet-blocker policy |
| Lost payment/pass continuation | Agent drops IDs; empty paid re-entry 402 | Prior repair if continuation present |
| Duplicate 402 challenges | Expected for unpaid empty; bad if after settlement without IDs | Agent ID loss |
| Unnecessary reasoning | Platform | Nobu verbosity invites it |
| Repeated user questions | Dual models / incomplete contract | Store + resume gaps |
| Out-of-order steps | Action enum still callable free-form | Marketplace sequential OK |
| Slow Groq extraction | 20 s timeout path | Combined with discovery |
| Slow SerpApi discovery | Live search | Combined stage |
| Silent waiting | Combined extract+discover | No pending stage |
| Non-resumable failures | Mostly fixed for payment; discovery weaker | |
| Monitor/alert/stop failures | Not primary in latest evidence; must not regress | |

---

## 5. Security / matching locks (must not weaken)

- One settlement → one pass (`UNIQUE settlement_ref`)
- No second payment after recognized/pending recoverable settlement
- No monitoring before exact confirm + email + both consents + eligibility + redeem
- Target-only; Target Plus excluded; fail-closed matching
- No secrets/OTP/signatures in responses or logs
- No false price-drop on provider failure / ambiguity
- Stop excludes from scheduler; no refund language

---

## 6. Confirmed repair scope (this lane only)

In scope (Nobu-controlled):

1. Single-quote / wallet-preflight **conversation + machine fields** on every unpaid 402.  
2. Full conversation contract on free first contact.  
3. Short, one-action guidance everywhere on the paid→setup spine.  
4. Split marketplace extract vs discovery; durable purchase snapshot; product_discovery stage with resume.  
5. Bound marketplace Groq/SerpApi waits; truthful pending/retry_safe on discovery.  
6. Keep A2A daemon ready for proof.  
7. Focused tests + deploy + non-paid rehearsal + real journey.

Out of scope / hard locks:

- Do not change ASP `#5541`, service IDs, endpoints, or price.  
- Do not edit Production payment/pass/journey rows by hand.  
- Do not “fix” OKX re-quote by inventing client-side state.  
- Do not declare PASS from curl alone.

---

## 7. Design gate

Implementation begins only after `02-design.md` freezes the orchestration and response contract for this lane.
