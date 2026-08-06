# Production unpaid probes

**Date:** 2026-08-06  
**Deploy:** `usenobu-h3ieqdska-dtwoflicks-2878s-projects.vercel.app`  
**Alias:** `https://www.usenobu.xyz` (explicit)  
**Git HEAD:** `e3a83e5` (code `77751c9` + docs)

## Probes (no payment, no ASP mutation)

| Probe | Result |
|---|---|
| `GET /health` | **200** `{"status":"ok",...}` |
| `POST /v1/agent` `{}` | **400** `SERVICE_SELECTION_REQUIRED`; services 33561 + 35958; endpoints on `https://www.usenobu.xyz/...` |
| `GET /v1/agent/monitoring-pass` | **402** with `PAYMENT-REQUIRED`; body has empty business required fields; **no** `pass_claim_credential` / `claim_credential` |
| `POST /v1/agent` body `not-json` | **400** |
| Read-only live pass probe `pass_ec936ecc6d76445c949c891adcea351e` | **200** `MONITORING_ACTIVE` (unchanged active monitor) |

## Not performed

- No genuine payment / settlement replay
- No ASP `#5541` or service metadata edit
- No stop/alter of the live active monitor beyond read-only status

## Compatibility note

Marketplace journey valid input-required stages return HTTP **200** with `input_required` / `fields` / `requiredArgs` (proven locally + Onchain OS 4.4.0 matrix). Free service selection remains **400** by design.
