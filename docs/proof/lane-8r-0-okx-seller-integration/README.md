# Lane 8R.0 — Official OKX seller integration and deployment preflight

**Verdict:** `NOBU_LANE_8R_0_PASS`

## Integration selected

**Official authenticated OKX HTTP APIs** (not third-party x402 guides), matching `OKXFacilitatorClient` in `github.com/okx/payments`:

| Step | Path |
|---|---|
| Verify | `POST /api/v6/pay/x402/verify` |
| Settle | `POST /api/v6/pay/x402/settle` |
| Status | `GET /api/v6/pay/x402/settle/status?txHash=…` |

Auth: HMAC-SHA256 `OK-ACCESS-KEY` / `OK-ACCESS-SIGN` / `OK-ACCESS-TIMESTAMP` / `OK-ACCESS-PASSPHRASE`.

Challenge (server-built only): x402 **v2**, scheme `exact`, network `eip155:196`, asset USD₮0 `0x779ded0c9e1022225f8e0630b35a9b54be713736`, amount `990000`, `payTo` from `OKX_PAY_TO`/`PAY_TO`.

Required env (fail closed if missing): `OKX_API_KEY`, `OKX_SECRET_KEY`, `OKX_PASSPHRASE`, `OKX_PAY_TO` (or `PAY_TO`).

## Behavior

- Signature verification alone **never** activates monitoring.
- Settle failure / pending → no activation; pending returns `PAYMENT_SETTLEMENT_PENDING`.
- Confirmed settle → existing durable activation saga (exactly-once).
- Status API reconciliation → activate once, no re-pay.
- Raw payment credentials / signatures never stored or logged.

## Focused tests

```
tests/payments/okx-seller-adapter.test.ts — 11 passed
tests/payments/start-monitoring.test.ts   — 9 passed (Lane 7.4D saga intact)
```

## Deployment preflight

See `deployment.json` after production deploy (health + free agent + paid fail-closed).

## Hard locks

- No ASP `#5541` edit/resubmit/activate
- No genuine payment performed
- Paid route remains private/unregistered until Lane 8R listing

## Next lane

**Lane 8R — Accurate edit/resubmit of ASP #5541**
