# OKX User-role marketplace journey repair

**Date:** 2026-08-05
**Baseline HEAD:** `3d9c8652a565c6713135767e602e3e238e70d67d`
**Final HEAD:** `c35468f5fb83bf56cd2f3d98a76e9fe1c7ae205d`
**Verdict:** `NOBU_USER_ROLE_JOURNEY_REPAIR_PASS`

## Root cause

Calling OKX User agents:

1. Assumed paid service `35958` from Agent `5541` alone.
2. Did not list services `33561` and `35958`.
3. Asked the user to describe Nobu and invent service parameters.
4. Inspected payment balance before service selection.
5. After payment, lacked a clear handoff to free Purchase Setup (`CONFIRM_USE_PASS` / service 33561).
6. Setup stages asked users to resubmit internal `journey_id` instead of automatic machine continuation.

Provider code conflicts on baseline:

- Free descriptor set `payment_status: "required"`.
- Paid endpoint advertised on free Vercel host.
- First contact required internal `action` only.
- `marketplaceFirstContact` required a Monitoring Pass.
- Unpaid 402 lacked empty required-field arrays and structured deliverable.
- Conversation contract invented user-facing `action` from `next_action` alone.

## Contract design

Single catalogue: `src/a2mcp/service-catalogue.ts`

| ID | Name | Price | Registered endpoint |
|---|---|---|---|
| 33561 | Nobu Purchase Setup | free | `https://www.usenobu.xyz/v1/agent` |
| 35958 | Nobu Monitoring Pass | 0.99 USDT | `https://www.usenobu.xyz/v1/agent/monitoring-pass` |

- Generic Agent contact → `SERVICE_SELECTION_REQUIRED` (both services; payment not required).
- Machine actions: `DESCRIBE_SERVICES`, `SELECT_SERVICE`.
- Paid unpaid 402: no business input; `protocol_replay` for PAYMENT-SIGNATURE (never user-visible); one-quote balance guidance.
- Issued pass → `MONITORING_PASS_ISSUED`, `next_action: CONFIRM_USE_PASS`, `next_service_id: 33561`.
- Marketplace stages: `current_step`, `automatic_continue`, `machine_continuation`; product discovery automatic.

## Hard locks observed

No `agent update`, `agent activate`, resubmission, genuine payment, wallet funding, or new Agent/service creation.

## Focused tests

```
npx vitest run tests/a2mcp/service-catalogue.test.ts \
  tests/a2mcp/free-agent-validation.test.ts \
  tests/a2mcp/conversation-contract.test.ts \
  tests/a2mcp/user-role-journey-contract.test.ts \
  tests/a2mcp/marketplace-journey.test.ts \
  tests/payments/monitoring-pass.test.ts
```

Result: **61/61 passed**. Typecheck clean. Production build clean. `git diff --check` clean.

## Deployment

| Item | Value |
|---|---|
| Commit | `c35468f5fb83bf56cd2f3d98a76e9fe1c7ae205d` |
| Deploy ID | `dpl_BcEVaj8A1zGW6FL41FANa6z1z6tc` |
| Deployment URL | `https://usenobu-nz4f6jmib-dtwoflicks-2878s-projects.vercel.app` |
| Free alias | `https://www.usenobu.xyz` (explicitly re-aliased) |
| Paid / consumer alias | `https://www.usenobu.xyz` |

## Direct Production probes (unpaid)

### Free `https://www.usenobu.xyz/v1/agent`

| Probe | HTTP | Result |
|---|---|---|
| GET | 400 | `SERVICE_SELECTION_REQUIRED`, agent 5541, services 33561+35958, `payment_status=not_required`, fields=`service_id` |
| POST `{}` | 400 | same |
| POST generic message agent 5541 | 400 | same; guidance forbids assume-service / describe-Nobu / balance preflight |
| POST SELECT_SERVICE 33561 | 200 | free selected, `payment_status=not_required` |
| POST SELECT_SERVICE 35958 | 200 | paid selected, deliverable monitoring_pass×1, no params, paid_endpoint catalogue URL |

### Paid `https://www.usenobu.xyz/v1/agent/monitoring-pass`

| Probe | HTTP | Result |
|---|---|---|
| GET | 402 | PAYMENT-REQUIRED present; x402 v2 exact eip155:196 amount 990000; resource URL paid host |
| POST `{}` | 402 | same; `input_required=false`; empty required fields; deliverable; one_quote_only; insufficient_balance preserves quote |

Header/body agreement: resource URL match, amount match.

### Official x402-check

```
onchainos agent x402-check --endpoint https://www.usenobu.xyz/v1/agent/monitoring-pass
```

Result: `"valid": true`, x402Version 2, scheme exact, network eip155:196, amount 990000, token USDT.

## Unpaid User-role scenarios (HTTP machine contract)

These are the machine responses a User-role agent receives for the three prompts (no payment authorized).

### A. Fresh: "I would like to use the service of agent 5541"

- Both services listed (33561 free, 35958 paid with distinct endpoints).
- `service_selection_required: true`, only `service_id` required.
- `payment_status: not_required` — no wallet check required yet.
- Guidance: do not assume service; do not ask user to describe Nobu; do not inspect balance before paid selection.

### B. Explicit paid: SELECT_SERVICE 35958 / Monitoring Pass

- Clear deliverable `{type: monitoring_pass, quantity: 1}`.
- No product/email/wallet/threshold service parameters.
- Paid endpoint + payment_status required only after selection; unpaid paid route is payment confirmation only.

### C. Prior paid context then generic Agent 5541 request

- New generic envelope returns fresh `SERVICE_SELECTION_REQUIRED`.
- Paid service not silently assumed (`selected_service_id` absent).

## Platform-controlled boundary

Nobu owns API introduction, service catalogue, paid 402 body/header, journey stage contracts, and post-payment handoff fields.
OKX/Onchain OS owns job wrappers, wallet balance UI, and whether the buyer agent obeys machine guidance.
If a future interactive OKX.AI chat still assumes a service despite `SERVICE_SELECTION_REQUIRED`, that is a platform consumption issue — do not mutate ASP `#5541` metadata.

## Confirmation

- No genuine payment.
- No ASP update / activate / resubmission.
- No new Agent or service creation.
- No private keys, seeds, cards, bank details, 2FA, or raw payment headers exposed.
