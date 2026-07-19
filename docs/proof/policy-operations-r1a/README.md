# Proof — Lane 8-R1A Sustainable Policy Operations

| Field | Value |
|---|---|
| Lane | 8-R1A |
| Starting commit | `73b7fbfcafed0132759e93f5a8179e9921b0e733` |
| Policy verification timestamp | `2026-07-19T18:00:00.000Z` |
| Official source | Target Price Match Guarantee (manual review; no scrape) |

## What changed

**Previous runtime:** `evaluateTargetPolicy` returned `POLICY_STALE` when `hoursBetween(verified_at, now) > 24`, fully blocking confirmed-purchase checks.

**New runtime:** operational `review_state` drives behavior. Overdue review → `CHECK_DUE` (continue service + warning + owner alert). `POLICY_STALE` only for retired / grace-expired unusable states.

## Artifacts

| File | Purpose |
|---|---|
| `targeted-test-summary.txt` | Redacted vitest summary for targeted suites |
| `prod-health-redacted.json` | Production `/health` (if deploy succeeded) |
| `prod-agent-probe-redacted.json` | Production `POST /v1/agent` probe (if deploy succeeded) |

## Local proof commands

```text
npx vitest run tests/policy/freshness.test.ts tests/policy/policy-operations.test.ts tests/policy/target-policy-fixtures.test.ts tests/db/migration.test.ts tests/a2mcp/a2mcp.test.ts tests/serpapi/redact.test.ts
git diff --check
```

## Production proof checklist

1. Deploy via existing authenticated Vercel workflow.
2. `GET https://usenobu.vercel.app/health` — expect `status: ok`, policy ops fields present, not a hard stale block.
3. `POST https://usenobu.vercel.app/v1/agent` canonical `CHECK_CONFIRMED_PURCHASE` — must not return empty `POLICY_STALE` solely because 24h elapsed.
4. Response still includes honest Target-policy provenance and optional `policy_warning` / `policy_review_state`.
5. Do not manufacture a price drop.

## Production result (2026-07-19)

- Deployed project `usenobu`; aliased `usenobu.vercel.app` to deployment `usenobu-e9x1qi35w-…`.
- Health: `status: ok`, `policy_review_state: CURRENT`, `policy_warning: null` — see `prod-health-redacted.json`.
- Canonical agent probe: `PRICE_DROP_DETECTED` (not `POLICY_STALE`), with `policy_version`, `policy_verified_at`, `policy_review_state: CURRENT`, Target final-decision provenance — see `prod-agent-probe-redacted.json`.
- Observed AirTag price drop was live SerpApi data, not manufactured.

## Agent listing

Agent `5541` and its under-review OKX listing were **not** modified in this lane.
