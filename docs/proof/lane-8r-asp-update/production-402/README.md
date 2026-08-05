# Production 402 proof (Gate 3)

**Result:** PASS — `production_402_proven: true`

## Controlled flow (not customer traction)

1. `DISCOVER_PRODUCT` — Target AirTag exact identity (URL + TCIN)
2. `CONFIRM_PRODUCT`
3. `BEGIN_EMAIL_VERIFICATION` / `VERIFY_EMAIL_CODE` (temp mailbox; code redacted)
4. `PREFLIGHT_MONITORING` → `MONITORING_PAYMENT_READY`, `$0.99` quote

Redacted: email, code, `connection_token`, quote/connection/purchase ids.

## Unpaid paid-route call

`POST https://www.usenobu.xyz/v1/agent/start-monitoring` without `PAYMENT-SIGNATURE`

| Check | Result |
|---|---|
| HTTP status | `402` |
| Body status | `PAYMENT_PENDING` |
| `Payment-Required` header | present non-empty |
| x402Version | `2` |
| resource | `https://www.usenobu.xyz/v1/agent/start-monitoring` |
| accepts count | `1` |
| scheme | `exact` |
| network | `eip155:196` |
| asset | `0x779ded0c9e1022225f8e0630b35a9b54be713736` |
| amount | `990000` |
| payTo | present + valid EVM syntax (value redacted) |
| extra.quote_id | matches issued quote |

See `contract-checks.json` and `challenge-redacted.json`.

## No side effects

- Immediate unpaid replay → still `402` / `PAYMENT_PENDING`
- `LIST_ACTIVE_MONITORS` → count `0`
- No genuine payment / settlement / alert claimed
