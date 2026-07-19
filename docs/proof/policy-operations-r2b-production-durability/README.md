# Proof — Lane 8-R2B Production Postgres Provisioning and Durability Closeout

| Field | Value |
|---|---|
| Lane | 8-R2B |
| Baseline commit | `67fc869746e9ac095f6c5f0faad44e87823b72c1` |
| Verdict | **`NOBU_LANE_8_R2B_BLOCKED_DATABASE_PROVISIONING`** |
| SerpApi searches consumed | **0** |

## Summary

Lane 8-R2A code is deployed and fail-closed: production `/health` reports `policy_ops_store: unavailable` and does **not** invent `CURRENT`.

`OWNER_OPS_SECRET` and `CRON_SECRET` are configured on Vercel Production.

Hosted PostgreSQL could **not** be provisioned in this non-interactive agent environment. The preferred path (Vercel Marketplace **Neon**) requires **owner browser acceptance** of marketplace terms before install can finish.

No connection string was created, printed, or committed.

## Artifacts (redacted only)

| File | Purpose |
|---|---|
| `baseline-health-redacted.json` | Production health before Postgres |
| `prod-env-names-redacted.json` | Env var **names** only |
| `provision-attempt-redacted.json` | Neon marketplace install attempt + block reason |
| `local-docker-postgres-still-pass-redacted.json` | Local Docker PG integration still PASS |
| `targeted-checks.txt` | Commands run |

## Exact owner action required (unblock)

1. Open Vercel team marketplace terms for Neon and accept them:
   - `https://vercel.com/dtwoflicks-2878s-projects/~/integrations/accept-terms/neon?source=cli`
   - Or: Vercel Dashboard → Integrations → accept Neon marketplace terms  
2. From the repo root (linked project `usenobu`), re-run:

```text
npx vercel integration add neon --name nobu-policy-ops --environment production
```

3. After Neon provisions a database URL (often `DATABASE_URL` or `POSTGRES_URL` / `POSTGRES_URL_NON_POOLING`):
   - Copy the **server-side** connection string into a **new** Production env var named **only**:

```text
POLICY_OPS_DATABASE_URL
```

   - Prefer the non-pooling / direct connection if Neon provides both (compatible with the `pg` adapter).
   - Do **not** put the URL in `NEXT_PUBLIC_*` or commit it.
4. Redeploy production and alias `usenobu.vercel.app`.
5. Re-run the durability checklist from this lane’s task (scheduler → CHECK_DUE → UNCHANGED → redeploy survival).

Alternate owner path: create any hosted Postgres (Neon console, Supabase, Prisma Postgres, etc.), set `POLICY_OPS_DATABASE_URL` on Vercel Production only, redeploy, then re-run Lane 8-R2B proof steps.

## What was verified without hosted Postgres

| Check | Result |
|---|---|
| Pre-existing secrets present | `OWNER_OPS_SECRET`, `CRON_SECRET` names listed in Vercel Production |
| `POLICY_OPS_DATABASE_URL` | Absent |
| Production health | `degraded` / `policy_ops_store: unavailable` (honest) |
| Local Docker Postgres store tests | PASS (schema init + scheduler + UNCHANGED) |
| No SerpApi | Confirmed (no price probes) |
| Agent `5541` | Untouched |

## What was **not** completed

- Hosted production Postgres provision  
- Production schema init on hosted DB  
- Production CHECK_DUE / UNCHANGED / cold-start / redeploy durability  
- Shared-store agreement across production health / owner / A2MCP with store `ok`

## Agent listing

Agent `5541` and its under-review OKX listing were **not** modified.
