# Lane 7.4E — Agent-native monitor management

**Verdict:** `NOBU_LANE_7_4E_PASS`

## Implemented free `/v1/agent` actions

| Action | Behavior |
|---|---|
| `LIST_ACTIVE_MONITORS` | Owner-scoped, active + unstopped + locked fingerprint only |
| `ENABLE_EMAIL_ALERTS` | Reuses `setEmailAlertPreference`; durable consent |
| `DISABLE_EMAIL_ALERTS` | Does not stop monitoring |
| `STOP_MONITORING` | `monitoring_stopped_at` + `user_requested`; idempotent 200 |
| `CHECK_MONITORING_STATUS` | Account-owned requires connection; same not_found for missing/cross-owner |

## Proof

| Check | Result |
|---|---|
| `tests/web/agent-monitor-management.test.ts` | 6 passed |
| Agent connections regression | 12 passed |
| Agent preflight regression | 15 passed |
| Email alerts regression | 10 passed |
| Monitoring selection regression | 7 passed |
| Migration 0008 | passed |
| typecheck | pass |
| build | pass |
| git diff --check | clean |

## Hard locks

- No new scheduler or notification system
- No new monitor entity
- No payment changes
- No deploy; ASP #5541 unchanged
- Paid start-monitoring route remains private/unregistered

## Next lane

**Lane 7.4F — Scheduler and notification integration**
