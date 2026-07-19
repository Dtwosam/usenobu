# Proof — Lane 8-R2 Canonical Acceptance + Policy Durability

| Field | Value |
|---|---|
| Lane | 8-R2 |
| Baseline commit | `24c59f5517122adca3ec3961d410aa517e807f67` |
| Audit doc | `docs/nobu-lane-8-r2-canonical-proof-and-policy-durability-audit.md` |
| Verdict | `NOBU_LANE_8_R2_BLOCKED_POLICY_STATE_NOT_DURABLE` |
| Extra SerpApi queries | **0** |

## Artifacts

| File | Purpose |
|---|---|
| `r1a-request-reconstructed-redacted.json` | R1A agent request archive (no re-query) |
| `prod-owner-status-no-auth-redacted.json` | Owner status without secret → 503 |
| `prod-owner-status-bad-bearer-redacted.json` | Bad bearer with secret unset → 503 |
| `prod-owner-scheduler-no-auth-redacted.json` | Scheduler without secret → 503 |
| `prod-owner-page-redacted.json` | Public owner page (no secret values) |
| `prod-health-policy-fields-redacted.json` | Health memory-based policy fields |
| `prod-env-names-redacted.json` | Production env names only |

## Summary

- Canonical R1A `PRICE_DROP_DETECTED` **accepted**.
- Production policy-ops persistence is **not durable** (process memory + `/tmp` SQLite; no owner secret).
