# User-role journey follow-up repair

**Baseline:** `b0c28de03cc24b7668de1898718f8f237296d500`  
**Deployed code commit:** `13113f1ed729fd67ff35919cbddf7b5f72e7b7ae`  
**Deploy ID:** `dpl_BZPj3UKLyPbY1U1iFMSyGks33zYR` (`usenobu-o6k9mv5cb-…`)  
**Proof-docs HEAD:** (this commit after documentation)  
**Verdict:** `NOBU_USER_ROLE_JOURNEY_FOLLOWUP_REPAIR_PASS`

## Findings repaired

1. **Bare `service_id` selection** — `/v1/agent` accepts `{"service_id":33561|35958}` (number or string) without `action: SELECT_SERVICE`, same as explicit SELECT_SERVICE. Unknown IDs still return `SERVICE_SELECTION_REQUIRED`.
2. **No-result discovery** — after discovery runs with zero/fail, returns `MORE_INFORMATION_REQUIRED` on `purchase_description` with `automatic_continue: false` and `machine_continuation: null` (no SerpApi auto-loop on the same snapshot).
3. **`activation_pending` durable stage** — redemption pending saves stage + quote_id; resume with `journey_id` only reuses existing quote/pass/connection via idempotent `redeemMonitoringPassForAgent` / activation resolution; no second payment, preflight, or consent.
4. **Human stages** — `machine_continuation: null` (only automatic stages carry it). `journey_id` remains top-level, never in user required fields.

## Focused tests

```
tests/a2mcp/user-role-followup-repair.test.ts
+ related journey / free / conversation / catalogue / monitoring-pass suites
```

**71/71 passed.** Typecheck clean. Production build clean. `git diff --check` clean.

## Production unpaid probes

| Probe | Result |
|---|---|
| POST `{"service_id":33561}` free | **200** `SERVICE_SELECTED` free, `payment_status=not_required` |
| POST `{"service_id":35958}` free | **200** `SERVICE_SELECTED` paid, `payment_status=required` |
| Official x402-check paid | **`valid: true`** x402 v2 exact eip155:196 amount 990000 |
| Paid GET | **402** `PAYMENT_PENDING`, `input_required=false`, empty fields |

No-candidate discovery and activation_pending resume proven in focused unit/integration tests (not live payment).

## Hard locks observed

- No payment  
- No ASP update / activate / resubmit  
- No new Agent or service  
- No price, network, token, payTo, matching, policy, or consent rule changes  

## Aliases

- Free: `https://usenobu.vercel.app` re-aliased to this deploy  
- Paid/consumer: `https://www.usenobu.xyz`  
