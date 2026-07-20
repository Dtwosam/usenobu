# Lane 7.3B — Consented automatic price-drop email alerts

**Verdict:** `NOBU_LANE_7_3B_PASS` (local proof complete; production Resend smoke depends on project secrets)

## What shipped

- Purchase-level consent: **Email me about possible price drops** (off until enabled)
- Verified Nobu account email only (masked in UI); no second email field
- Nobu notification workflow after deterministic new `PRICE_DROP_DETECTED` alert
- Durable `email_notifications` ledger (opportunity_key idempotency)
- Anti-spam: 1 immediate/purchase/24h, 3 immediate/account/24h, summary thereafter
- Controlled schedule: max 1 scheduled provider check / purchase / 24h; manual 6h production cooldown
- Scheduler endpoint: `POST /v1/owner/monitor-scheduler` (Bearer `CRON_SECRET`)

## Proof

| Check | Result |
|---|---|
| Unit: consent / email / auth | `tests/notifications/email-alerts.test.ts` — 10 passed |
| Migration 0007 | `tests/db/migration.test.ts` — passed |
| Monitoring regression | `tests/monitoring/monitoring.test.ts` — 7 passed |
| Lifecycle / auth / manual-check | 27 passed |
| typecheck | pass |
| build | pass |
| Playwright email preference UI | `tests/e2e/email-alerts.spec.ts` — 1 passed |
| git diff --check | clean (CRLF warnings only) |

## Screens

- `screens/desktop-guest-alert-pref.png`
- `screens/desktop-alerts-enabled.png`
- `screens/mobile-390-alert-pref.png`

## Hard locks preserved

- Target only; Target Plus excluded
- SerpApi third-party observation
- Deterministic fail-closed matching/policy/alerts
- No refund guarantees
- ASP #5541 / `/v1/agent` unchanged
