# Non-paid rehearsal — payment confirmation gate

**Date:** 2026-07-28
**Deploy:** `www.usenobu.xyz` → `usenobu-jsd3udipq…`
**Payment authorized:** **no**

## Procedure

1. Confirm A2A: `okx-a2a doctor` → ready (daemon pid 26080).
2. Confirm wallet: `onchainos wallet status` → `loggedIn: true`.
3. Confirm free intro: `POST /v1/agent` `{}` → 400, both services, `payment_status=required`, `second_payment_required=false`.
4. Confirm paid challenge: `POST /v1/agent/monitoring-pass` `{}` → 402 with one-quote machine fields.
5. **Exactly one** official quote:

```text
onchainos payment quote --method POST https://www.usenobu.xyz/v1/agent/monitoring-pass
```

## Results

| Item | Value |
|---|---|
| Quote duration | 3179 ms |
| `paymentId` | `pay_92037700c330a3c7ddd24f94` |
| Quote count this rehearsal | **1** |
| `walletError` | **none** |
| `hasBalance` | **true** |
| `needsConfirm` | true |
| `nextStep` | `onchainos payment pay --payment-id pay_92037700c330a3c7ddd24f94 … --yes` |
| Merchant `one_quote_only` | true |
| Merchant `quote_policy` | `single_deliberate_attempt` |
| Merchant `do_not_re_quote_on` | balance_unavailable, insufficient_balance, payment_pending |
| Second quote run | **not performed** |
| Owner reconcile / DB edit | **none** |

## Gate decision

`READY_FOR_FAST_FRESH_VIDEO_RECORDING`

### Operator recording notes

- If quote TTL (~300 s) expires before record, run **one** fresh quote only; discard older `pay_*`.
- On `balance_unavailable`: fix wallet; **do not** re-quote thrice.
- Authorize at most one pay; never retry.
- After pay: expect auto pass / pending+RESOLVE; never a second charge.
