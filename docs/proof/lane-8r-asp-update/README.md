# Lane 8R — Production 402 proof + ASP #5541 update and resubmission

**Date:** 2026-07-21  
**Verdict:** `NOBU_LANE_8R_PASS`  
**Base work:** production seller env + redeploy; agent identity fallback for confirmable exact Target URL/TCIN; ASP `#5541` update + activate once

## Summary fields

| Field | Value |
|---|---|
| `approval_status` | `2` (Listing under review) |
| `free_service_id` | `33561` |
| `paid_service_id` | `35958` |
| `production_402_proven` | `true` |
| `public_listing_url` | `not_yet_available` |
| `genuine_payment_performed` | `false` |

## Checklist

| Gate | Result |
|---|---|
| 1. Production seller configuration (deployed-runtime readiness) | **PASS** |
| 2. Basic production preflight | **PASS** |
| 3. Valid production 402 + no side effects | **PASS** |
| 4. ASP #5541 read-only inspect | **PASS** |
| ASP update (one call) | **PASS** (`newAgentId: null`) |
| Activate / resubmit (one call) | **Recorded** — `activate.success: false`, `approvalStatus: 2`, `rejectReason: null` (already under review after accepted update) |
| After-state services | **PASS** (free + paid) |
| Marketplace public URL | **not_yet_available** (`/okx` fallback unchanged) |

## Gate 1 — Seller configuration (no local Sensitive value pull)

- Production env **names** present: `OKX_API_KEY`, `OKX_SECRET_KEY`, `OKX_PASSPHRASE`, `OKX_PAY_TO` (`vercel env ls production`; booleans only).
- **Not** used as value evidence: local `vercel env run` (Sensitive values).
- Canonical hosts `www.usenobu.xyz` and `usenobu.vercel.app` → production Ready deploy after OKX env + identity fix (`usenobu-f9a2nf6xp-…`).
- Deployed-runtime proof: production `402` challenge includes non-null `payTo` matching `/^0x[a-fA-F0-9]{40}$/` (seller config is all-or-nothing in `loadOkxSellerConfig`).
- Server binds amount/asset/network/resource/`payTo`; client cannot override (strict body schema).

Evidence: `gate1-seller-configuration.json`, `production-402/`.

## Gate 2 — Preflight

- `GET /health` → `200`
- Free `UNDERSTAND_PURCHASE` → `200`
- Malformed paid → `400`
- Unauthorized paid → `401` `ACTION_NOT_AUTHORIZED`
- No credentials/payment material in responses

Evidence: `gate2-preflight.json`

## Gate 3 — Production 402

Controlled internal free-agent flow (not customer traction): discover → confirm → email verify → preflight → unpaid `start-monitoring`.

- HTTP `402`, body `PAYMENT_PENDING`, `Payment-Required` present
- Decoded challenge: x402 v2, resource `https://usenobu.vercel.app/v1/agent/start-monitoring`, exact / eip155:196 / USD₮0 / `990000`, `payTo` present+valid, `extra.quote_id` matches
- Replay still `402`; `LIST_ACTIVE_MONITORS` count `0`; no genuine payment

Evidence: `production-402/contract-checks.json`, `challenge-redacted.json`, `summary.json`

## ASP #5541

### Before

- Free only: id `33561`, fee `0`, endpoint `/v1/agent`, name “Post-checkout price watch”
- Under review (`approvalDisplayStatus: 2`)

### Mutation (one update)

- Agent description → final product copy
- Free service **update** id `33561` (name shortened to **Nobu Purchase Setup** for official 5–30 char limit; fee/endpoint preserved)
- Paid service **create**: **Nobu Monitoring Activation**, fee `0.99`, endpoint `/v1/agent/start-monitoring`
- `validate-listing` pass before update
- Response: `ok: true`, `newAgentId: null`, txHash recorded in `update-response-redacted.json`

### Activate once

```json
{"ok":true,"data":{"activate":{"approvalStatus":2,"rejectReason":null,"success":false}}}
```

Truthful interpretation: update accepted; listing remains **under review**; activate did not flip to publicly listed (expected until marketplace approval).

### After

| Service | ID | Fee | Endpoint |
|---|---|---|---|
| Nobu Purchase Setup | 33561 | 0 | `https://usenobu.vercel.app/v1/agent` |
| Nobu Monitoring Activation | 35958 | 0.99 | `https://usenobu.vercel.app/v1/agent/start-monitoring` |

Evidence: `before-state-redacted.json`, `after-state-redacted.json`, `mutation-payload-redacted.json`, `service-consistency.json`, `no-second-asp.json`, `no-genuine-payment.json`

## Supporting product fix

Agent `DISCOVER_PRODUCT` now applies the same Lane 7.2 user-provided exact Target identity fallback as the website when live SerpApi offers lack confirmable Target links. Focused test added; production redeployed before 402 proof.

## Hard locks held

- No second ASP
- Free fee remains `0`
- No genuine payment
- No secrets in proof (names/booleans/redacted challenge only)
- Public listing URL not invented

## Exact next lane

**Lane 7.4G — Live marketplace end-to-end proof** — do not start until ASP `#5541` / paid service are officially accessible through OKX.AI.
