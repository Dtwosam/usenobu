# Production unpaid probes

## Recovery FINAL deploy (claim boundary + concurrent count) (2026-08-06)

**Deploy:** `usenobu-5a6w2xj3t-dtwoflicks-2878s-projects.vercel.app`  
**Alias:** `https://www.usenobu.xyz` (explicit)  
**Code commit:** `c8eaac9`

| Probe | Result |
|---|---|
| `GET /health` | **200** |
| `GET /v1/agent/monitoring-pass` | **402** |
| `POST /v1/agent` `{}` | **400** service selection |
| Live pass `pass_ec936ecc6d76445c949c891adcea351e` | **200** `MONITORING_ACTIVE` `monitoring_active=true` |

No genuine payment. No ASP mutation. Live monitor not stopped/altered.

## Recovery repair deploy (2026-08-06)

**Deploy:** `usenobu-gpnco5w1s-dtwoflicks-2878s-projects.vercel.app`  
**Code commit:** `c506695`

| Probe | Result |
|---|---|
| health / unpaid paid / free / live | 200 / 402 / 400 / MONITORING_ACTIVE |

## Prior interoperability deploy

**Deploy:** `usenobu-h3ieqdska-dtwoflicks-2878s-projects.vercel.app`  
**Git HEAD (at time):** `e3a83e5` / code `77751c9`

| Probe | Result |
|---|---|
| `GET /health` | **200** `{"status":"ok",...}` |
| `POST /v1/agent` `{}` | **400** `SERVICE_SELECTION_REQUIRED` |
| `GET /v1/agent/monitoring-pass` | **402** with `PAYMENT-REQUIRED`; no claim secret |
| `POST /v1/agent` body `not-json` | **400** |
| Live pass `pass_ec936ecc…` | **200** `MONITORING_ACTIVE` |

## Compatibility note

Marketplace journey valid input-required stages return HTTP **200** with `input_required` / `fields` / `requiredArgs` (proven locally + Onchain OS 4.4.0 matrix). Free service selection remains **400** by design.
