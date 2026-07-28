# Live payment pre-confirm (Phase 2 gate)

**Date:** 2026-07-28  
**Job (ASP view):** `0x52570c24b70e1cd2ea4563848185d22d1e52a59f238c33282d95039f31c082a6`  
**Buyer agent (from ASP playbook):** `6058`  
**Provider:** `5541`  
**Service:** `35958` Monitoring Pass  
**Payment authorized:** **no** (UI at `Proceed with payment? (yes / no)`)

## Observed client behavior

| Item | Value |
|---|---|
| User-visible time to payment confirmation | **4 minutes 54 seconds** |
| `onchainos payment quote` executions | **3** |
| Payment IDs (order observed) | `pay_f5e63f8ca17bfb769bb9e85d` → `pay_ffd21c379d442bc9851d50f0` → `pay_d77c57836221c52362a01c24` |
| Quote terms (all three) | X Layer `eip155:196`, `0.99` USD₮0, asset `0x779ded0c9e1022225f8e0630b35a9b54be713736`, payTo `0x27463FD6F0a3a8220aC5bB612360B2958662B70B` |
| `walletError` (all three) | `balance_unavailable` |
| Funds moved | **none** |

## Why three quotes (not one)

Official Path A is **one** `payment quote` → confirm → one `payment pay --payment-id --yes`. Re-quote is only prescribed for `walletError: login_required`.

Three distinct `pay_*` IDs means the **User-role OKX.AI agent re-invoked `payment quote` three times**. Each quote:

1. probes the merchant endpoint for a fresh 402,
2. runs client-side wallet balance preflight,
3. persists a **new** local `paymentId`.

Most likely driver of the triple run: repeated quote attempts while `walletError` stayed `balance_unavailable` (agent retry / multi-turn re-entry), not Nobu requesting multiple charges. Nobu’s unpaid path is idempotent challenge-only.

**Nobu does not create `pay_*` IDs.** Those are local Onchain OS quote records on the buyer machine.

## Latency breakdown (to confirmation)

| Segment | Attribution | Evidence |
|---|---|---|
| Nobu `/v1/agent/monitoring-pass` unpaid 402 | **Nobu** | Live probes this session: GET ~0.53 s, POST ~0.54–1.52 s, three sequential POSTs ~0.54+0.54+0.62 s |
| Single historical `payment quote` (probe + balance preflight + persist) | **OKX CLI** | Local audit (prior day, same endpoint): `duration_ms` ≈ **5000** |
| Skill load / preflight / multi-turn agent reasoning / 3× quote orchestration / wait-to-confirm | **OKX User client / orchestration** | Dominant share of **4m54s**; far above 3×(Nobu 402 + quote CLI) |
| ASP wake session on job accept | **OKX ASP daemon (provider machine)** | `cliMs=47794` (~48 s) for wakeup/playbook; **not** the buyer payment path |

**Conclusion:** the 4m54s is **primarily OKX client/orchestration delay** (skill + agent turns + triple quote + wallet preflight failures). Nobu endpoint contribution is **seconds**, not minutes. **Does not meet** warm UX targets (payment challenge under 3 s user-visible).

## Challenge / merchant correctness

Terms on all quotes match Production Nobu Monitoring Pass challenge (amount `990000`, network, asset, payTo). Unpaid probes remain `402` with `second_payment_required: false`. Official x402-check still `valid: true`.

## Current safe payment ID

| ID | Role |
|---|---|
| `pay_f5e63f8ca17bfb769bb9e85d` | **Do not use** (stale earlier quote) |
| `pay_ffd21c379d442bc9851d50f0` | **Do not use** (stale earlier quote) |
| **`pay_d77c57836221c52362a01c24`** | **Current / only safe ID** for a single `payment pay` |

Quote state TTL historically ≈ **300 s** (`expires_at - created_at` and challenge `maxTimeoutSeconds: 300`). Prefer paying the latest ID promptly; if it expires, one new quote only — never pay earlier IDs.

## `balance_unavailable` meaning

Onchain OS `walletError` enum (binary + skill) distinguishes at least:

| Code | Meaning |
|---|---|
| `login_required` | No wallet session → log in, then re-quote (skill-prescribed) |
| **`balance_unavailable`** | **Balance lookup failed / balance could not be determined** (not a confirmed shortfall) |
| `insufficient_balance` | Lookup succeeded and balance is below the required amount |

So `balance_unavailable` is **not** proof the User wallet lacks USD₮0, and **not** itself a Nobu defect. It is a **buyer-side preflight opacity** (wallet/session/RPC/portfolio path). Before answering `yes`, the User must ensure the paying wallet is logged in and holds ≥ **0.99 USD₮0 on X Layer**.

Quotes never sign. Only `payment pay --payment-id … --yes` moves funds.

## ASP-side note (do not treat as paid)

Provider daemon processed job `0x52570c…` wakeup and playbook text claimed payment already confirmed via A2MCP. **User state contradicts that:** still at `Proceed with payment?`. Treat as **platform playbook mislabel of job_accepted / paymentMode**, not on-chain settlement. No owner reconcile; no Production DB edit.

## Controls for the single payment

- Authorize **at most one** pay against **`pay_d77c57836221c52362a01c24`** only.
- Do **not** create another quote unless the current ID expires or pay fails without settlement.
- Do **not** pay the first two IDs.
- After pay: require automatic pass issuance (`second_payment_required: false`); stop if a second 402/charge is requested.

## Verdict

`SAFE_TO_CONTINUE_SINGLE_PAYMENT_pay_d77c57836221c52362a01c24`
