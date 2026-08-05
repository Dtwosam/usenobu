# OKX User-role marketplace journey repair

**Date:** 2026-08-05  
**Baseline HEAD:** `3d9c8652a565c6713135767e602e3e238e70d67d`  
**Status:** code complete; deploy + unpaid Production probes recorded below when available.

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
| 33561 | Nobu Purchase Setup | free | `https://usenobu.vercel.app/v1/agent` |
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

## Production proof

Recorded after deploy (fill in):

- Deploy ID:
- Free GET/empty POST:
- Paid GET/empty POST + x402-check:
- User-role A/B/C (unpaid only):
