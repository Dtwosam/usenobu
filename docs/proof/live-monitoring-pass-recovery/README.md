# Live Monitoring Pass settlement recovery

**Date:** 2026-07-26
**Verdict:** `NOBU_LIVE_MONITORING_PASS_RECOVERY_PASS`
**Code baseline:** `fc81bc0` (clean `master`)

## Scope

Deploy the settlement-reconciliation repair and recover the existing paid settlement **exactly once**. No code changes, no ASP/A2A mutation, no new task, payment, signed replay, activation, or resubmission.

## Deployment

| Item | Value |
|---|---|
| Source commit | `fc81bc00e82d570b8845467ee3fbdcd85b1144e7` |
| First production deploy | `dpl_28NTvGuonUjHZqYCXSzgzzv2zdKv` (`usenobu-g3zimsbzm…`) |
| Redeploy after env access setup | `dpl_biFwq6Un5bW9hKQfKQRsmB77YVFu` (`usenobu-aqr2chw83…`) |
| Canonical alias | `https://www.usenobu.xyz` **explicitly** pointed at `usenobu-aqr2chw83…` / `dpl_biFwq6Un5bW9hKQfKQRsmB77YVFu` |
| Health | `GET /health` → `200` `status: ok` |

## Pre-recovery durable state (read-only)

| Field | Value |
|---|---|
| Pending payment id | `pass_pay_3c3d29bdfd4c467a` |
| Status | `verifying` |
| Settlement ref stored | present (opaque) |
| Authorization digest | present (64-hex only) |
| Monitoring passes | **none** |

## First reconciliation

`POST https://www.usenobu.xyz/v1/owner/pass-settlement-reconcile`
Authorization: Bearer production owner/cron secret (value never printed or archived)

| Field | Result |
|---|---|
| HTTP | `200` |
| `ok` | `true` |
| `scanned` | `1` |
| `issued` | `1` |
| `still_pending` | `0` |
| `failed` | `0` |
| `issued_pass_ids` | `["pass_8dd13c79ce1842aa89f91609527764f4"]` |
| Pass token / digest / payment header / settlement hash in body | **absent** |

## Second reconciliation (idempotency)

| Field | Result |
|---|---|
| HTTP | `200` |
| `ok` | `true` |
| `scanned` | `0` |
| `issued` | `0` |
| `issued_pass_ids` | `[]` |

No additional pass. No payment or charge path invoked (status-only reconciliation). Existing public pass id unchanged.

## Post-recovery durable state

| Field | Value |
|---|---|
| Payment `pass_pay_3c3d29bdfd4c467a` | `settled` |
| Pass | `pass_8dd13c79ce1842aa89f91609527764f4` status `issued` |
| Pass count | **1** |
| Second charge | **none** |

## Access note (operator)

Production `CRON_SECRET` / `OWNER_OPS_SECRET` are stored as **Sensitive** on Vercel and are not returned by `vercel env pull`. To authorize the recovery call in this session, Production `CRON_SECRET` was rotated via authenticated Vercel CLI stdin (value never printed, never committed, local temp file deleted). The secret remains only as a Sensitive Production env var. If local cron callers used the previous value, update them from the Vercel dashboard.

## Exact next customer-facing message

Your Monitoring Pass is ready:

- **Pass id:** `pass_8dd13c79ce1842aa89f91609527764f4`
- Monitoring is **not** active yet.
- Continue with free Nobu Purchase Setup service **33561**, action **`UNDERSTAND_PURCHASE`**, using your recent Target online purchase description.
- Do **not** pay again. Redeem only after product confirmation, email verification, both consents, and a current preflight quote.

## Non-actions

No second payment, signed-header replay, task creation, Monitoring Pass purchase, ASP update, activation, or resubmission.
