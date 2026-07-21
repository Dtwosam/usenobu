# Lane 8R — Production 402 proof, accurate ASP #5541 update and resubmission

**Date:** 2026-07-21  
**Base commit:** `92ef11bd4e37bb8abefc5ed0ab5f5a89d34c5a57`  
**Verdict:** `NOBU_LANE_8R_BLOCKED_GATE_1` — stopped on first failed gate

## Checklist

| Gate | Result | Notes |
|---|---|---|
| 1. Production seller configuration | **FAIL** | Required OKX seller env vars absent from production Vercel |
| 2. Production 402 contract (no payment) | **NOT RUN** | Blocked by Gate 1 |
| 3. ASP #5541 read-only inspect | **NOT RUN** | Blocked by Gate 1 |
| 4–6. Update ASP (keep free + add paid $0.99) | **NOT RUN** | Blocked by Gate 1 |
| 7. Resubmit ASP #5541 once | **NOT RUN** | Blocked by Gate 1 |
| 8. After-state evidence | Partial | Gate 1 stop recorded only |

## Hard locks observed

- No second ASP created.
- ASP `#5541` not edited, not resubmitted.
- No genuine payment attempted.
- No fake payment, transaction, user, alert, revenue, or activation proof.
- No secrets written to repository files, logs, CLI output, or proof (names only).

## Gate 1 — Production seller configuration

### Required (fail closed without all four)

| Env name | Purpose |
|---|---|
| `OKX_API_KEY` | OKX REST HMAC access key |
| `OKX_SECRET_KEY` | OKX REST HMAC secret |
| `OKX_PASSPHRASE` | OKX REST passphrase |
| `OKX_PAY_TO` (or `PAY_TO`) | Server-owned recipient wallet `0x` + 40 hex |

Source of truth: `src/payments/okx-seller-client.ts` (`loadOkxSellerConfig`) and Lane 8R.0 proof.

Optional (not required for Gate 1 pass): `OKX_BASE_URL` (default `https://web3.okx.com`), `OKX_SYNC_SETTLE`.

### Evidence (names only — no values)

Command: `vercel env ls production` against project `usenobu` (account `dtwoflicks-2878s-projects`).

**Present production names include:** `RESEND_API_KEY`, `EMAIL_FROM_ADDRESS`, `APP_BASE_URL`, `SESSION_SECRET`, `CRON_SECRET`, `OWNER_OPS_SECRET`, Postgres/Neon family, `NOBU_AI_MODEL`, `GROQ_API_KEY`, `SERPAPI_API_KEY`.

**Missing (all):**

- `OKX_API_KEY`
- `OKX_SECRET_KEY`
- `OKX_PASSPHRASE`
- `OKX_PAY_TO`
- `PAY_TO`
- `OKX_BASE_URL`
- `OKX_SYNC_SETTLE`

Also checked local `.env.local` for the same names: **absent** (names only).

See `gate1-seller-config.json`.

### Production smoke (not a 402 proof)

| Check | Result |
|---|---|
| `GET https://usenobu.vercel.app/health` | `200` |
| `POST /v1/agent/start-monitoring` with dummy quote/connection | `401` `ACTION_NOT_AUTHORIZED` (expected without valid connection) |

Paid route is reachable and fail-closed for unauthorized callers. That does **not** prove a valid quote-bound `402`/`PAYMENT-REQUIRED` challenge with configured `payTo`, because seller credentials are not present and Gate 2 was not attempted.

## Why Gate 2 was not run

Lane 8R requires: **Production OKX seller credentials must be configured before registration proof**. Without `OKX_*` + `payTo`, production resolves to `notConfiguredVerifier`. A 402 challenge would still omit a valid server `payTo` (or would not represent a production-ready seller contract). Proceeding to ASP update/resubmit would advertise a paid service the production environment cannot honestly settle.

## What was not done

- No production quote creation for a 402 proof.
- No ASP `#5541` read-only inspect via Onchain OS in this lane run (blocked before Gate 3).
- No ASP update, no paid service create, no resubmit.
- No deploy (configuration is missing; code already on base commit).

## Unblock path (operator)

1. Obtain OKX API credentials with seller/x402 access and a recipient wallet on X Layer.
2. Set on Vercel **Production** (and Preview if desired), **never commit values**:
   - `OKX_API_KEY`
   - `OKX_SECRET_KEY`
   - `OKX_PASSPHRASE`
   - `OKX_PAY_TO` = `0x` + 40 hex (checksum optional; must match `/^0x[a-fA-F0-9]{40}$/`)
3. Redeploy production so the runtime sees the new env (Vercel env changes require redeploy for existing deployments).
4. Re-run Lane 8R from Gate 1 on the same identity `#5541`.

## Current product truth (at stop)

- Paid route **implemented and deployed**.
- Paid route **not** registered as an ASP service.
- Official OKX seller verify/settle/settle-status **adapter implemented**.
- Production **fails closed** when seller configuration is absent — **and configuration is currently absent**.
- **No** genuine payment completed.
- Free A2MCP remains the only service historically registered under `#5541`.
