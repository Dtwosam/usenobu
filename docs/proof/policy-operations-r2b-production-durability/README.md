# Proof — Lane 8-R2B / 8-R2B.1 Production Policy Durability

| Field | Value |
|---|---|
| Lane | **8-R2B.1 — Complete Production Policy Durability** |
| Baseline commit | `e08102ee858fea31dda687754a0bc1a6557a3734` |
| Verdict | **`NOBU_LANE_8_R2B_PASS`** |
| Hosted DB | Neon Marketplace resource `nobu-policy-ops` (Vercel project `usenobu`, Production) |
| SerpApi searches | **0** |

## Infrastructure (names only)

| Item | Status |
|---|---|
| `POLICY_OPS_DATABASE_URL` | Production-only; server-only; not `NEXT_PUBLIC_*`; present; value never printed |
| Sensitive marking | Neon-managed URLs encrypted; `POLICY_OPS_DATABASE_URL` set via CLI (non-sensitive type due to prior sensitive-write empty-value CLI issue; still server-only). Recommend dashboard “Sensitive” toggle. |
| `OWNER_OPS_SECRET` | Production Encrypted; regenerated for this closeout (values not archived) |
| `CRON_SECRET` | Production Encrypted; regenerated for this closeout (values not archived) |

## Deployments

| Role | Deployment |
|---|---|
| Pre-redeploy proof | `usenobu-7gslesdzu-dtwoflicks-2878s-projects.vercel.app` |
| Post-redeploy survival | `usenobu-am8myke5z-dtwoflicks-2878s-projects.vercel.app` |
| Canonical alias | `https://www.usenobu.xyz` → post-redeploy deployment |

## Proof sequence (all redacted JSON in this directory)

| Step | Result | Artifact |
|---|---|---|
| Initial health | `policy_ops_store: ok` | `01-initial-health-redacted.json` |
| Force overdue `next_review_at` (test setup) | ok | `01b-force-overdue-redacted.json` |
| Scheduler → `CHECK_DUE` | transitioned + alert | `02-scheduler-first-redacted.json` |
| Health after scheduler | `CHECK_DUE` | `03-health-after-scheduler-redacted.json` |
| Owner status | `CHECK_DUE`, ≥1 alert | `04-owner-status-check-due-redacted.json` |
| Scheduler second call | no duplicate alert | `05` + `06` |
| Owner `UNCHANGED` | `CURRENT`, alerts 0 | `07-owner-unchanged-redacted.json` |
| Health/owner agree | both `CURRENT` | `08-post-unchanged-health-owner-redacted.json` |
| A2MCP metadata (AK early-exit, no SerpApi) | `CURRENT` | `09-a2mcp-policy-metadata-no-serpapi-redacted.json` |
| Cold-start multi-request | all `CURRENT`, store ok | `10-cold-start-multi-request-redacted.json` |
| Unauthorized | 401 | `11-unauthorized-redacted.json` |
| Review events persisted | `UNCHANGED` + scheduler events | `12-review-events-summary-redacted.json` |
| Post-redeploy alias + direct | `CURRENT`, alerts 0, store ok | `14-post-redeploy-survival-redacted.json` |
| Post-redeploy multi-request | consistent | `15-post-redeploy-multi-request-redacted.json` |

## Failure behaviour (isolated)

- `tests/policy/durable-store.test.ts`: production without Postgres URL does not silent-fallback; memory is test-only injection; `/tmp` forbidden for factory.
- Runtime health when store missing: `degraded` / `policy_ops_store: unavailable` (proven earlier in R2A when URL absent).

## Agent listing

Agent `5541` and under-review OKX listing were **not** modified.
