# Lane 7.4F — Scheduler and notification integration

**Verdict:** `NOBU_LANE_7_4F_PASS`

## Integration

| Step | Behavior |
|---|---|
| Select | `monitor_activations.status = 'active'` (bounded) |
| Hydrate | Purchase blobs → local scheduler DB; restore email prefs + notification ledger |
| Tick | Existing `runScheduledMonitoringTick` (same matcher/alerts/email) |
| Persist | Account-owned graphs + email meta → durable AuthStore |

## Proof (fixture observations + captured test emails)

| Case | Result |
|---|---|
| Agent + web same tick | pass |
| Agent price-drop → one alert + one email | pass |
| Fresh SQLite + durable store → no duplicate alert/email | pass |
| Email pref survives hydration | pass |
| Stopped agent not fetched / no provider / no email | pass |
| Disabled consent: still checks, no email | pass |
| Batch/budget limits intact | pass |

```
tests/monitoring/durable-scheduler-bridge.test.ts — 5 passed
monitoring + email-alerts + agent-monitor-management + start-monitoring regressions — passed
typecheck — pass
build — pass
```

## Hard locks

- No deploy; no ASP #5541 edit/resubmit; paid route unregistered
- No parallel scheduler/notification system
- No raw email, payment headers, or settlement refs in proof

## Next lane

**Lane 8R — Accurate edit/resubmit of ASP #5541**
