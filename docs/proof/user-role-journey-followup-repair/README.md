# User-role journey follow-up repair

**Baseline:** `b0c28de03cc24b7668de1898718f8f237296d500`  
**Code commit:** (fill after commit)  
**Proof-docs HEAD:** (fill after proof commit)  
**Verdict:** pending deploy proof

## Findings repaired

1. **Bare `service_id` selection** — `/v1/agent` accepts `{"service_id":33561|35958}` (number or string) without `action: SELECT_SERVICE`, same as explicit SELECT_SERVICE.
2. **No-result discovery** — after discovery runs with zero/fail, returns `MORE_INFORMATION_REQUIRED` on `purchase_description` with `automatic_continue: false` and `machine_continuation: null` (no SerpApi auto-loop).
3. **`activation_pending` durable stage** — redemption pending saves stage; resume with `journey_id` only reuses existing quote/pass/connection via idempotent redeem path; no second payment/consent.
4. **Human stages** — `machine_continuation: null` (only automatic stages carry it).

## Focused tests

`tests/a2mcp/user-role-followup-repair.test.ts` plus related journey/payment suites: **71/71** (pre-deploy).

## Hard locks

No payment, ASP update/activate/resubmit, price/network/token/payTo/matching/policy/consent changes.
