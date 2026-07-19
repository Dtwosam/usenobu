# Proof — Lane 8-R2A Durable Shared Policy-Operations Store

| Field | Value |
|---|---|
| Lane | 8-R2A |
| Baseline commit | `854552028e977441d3ed722429835b6234b0e228` |
| Contract | `docs/nobu-durable-policy-store-contract.md` |
| Extra SerpApi queries | **0** |

## Local proof

```text
npx vitest run tests/policy/durable-store.test.ts tests/policy/policy-operations.test.ts \
  tests/policy/freshness.test.ts tests/db/migration.test.ts tests/a2mcp/a2mcp.test.ts
npx tsc --noEmit
```

- Memory + SQLite store contract tests: **PASS**  
- Optional Postgres (`POLICY_OPS_TEST_DATABASE_URL` → local Docker `127.0.0.1:54322`): **PASS**  
- Migrations 0001–0005: **PASS**  
- No production silent fallback to memory/`/tmp`

## Production configuration (names only)

| Env | Status |
|---|---|
| `OWNER_OPS_SECRET` | Set on Vercel Production (sensitive) |
| `CRON_SECRET` | Set on Vercel Production (sensitive) |
| `POLICY_OPS_DATABASE_URL` / `DATABASE_URL` | **Not provisioned** (Neon auth timed out; no existing Vercel Postgres) |

## Production deployment probe (2026-07-19)

| Check | Result |
|---|---|
| Deploy | `usenobu-nm0767bne-…` aliased to `usenobu.vercel.app` |
| Health | `status: degraded`, `policy_ops_store: unavailable`, warning set, **not** fake CURRENT — see `prod-health-redacted.json` |
| Owner status bad bearer | **401** `unauthorized` (secrets present) |
| Scheduler bad bearer | **401** `unauthorized` |
| Hosted Postgres | **Not provisioned** (Neon CLI auth timed out; no prior Vercel Postgres) |

## Production durability

**Blocked on hosted Postgres.** Code fails closed when URL missing in production (`policy_ops_store_unavailable`). Do not claim production durability until a Postgres URL is configured and the redeploy survival checklist is re-run.

Secrets `OWNER_OPS_SECRET` and `CRON_SECRET` were configured on Vercel Production (values never recorded in proof).

## Redeploy durability checklist (when Postgres available)

1. Apply schema via app `ensureSchema`  
2. Confirm init seed  
3. Auth scheduler → CHECK_DUE  
4. Health + owner status agree  
5. Owner UNCHANGED → CURRENT, alerts cleared  
6. Redeploy; confirm state survives  
7. Direct deployment URL and `usenobu.vercel.app` agree  
8. No SerpApi spend  

## Agent listing

Agent `5541` and under-review OKX listing **untouched**.
