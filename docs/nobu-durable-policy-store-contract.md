# Durable Policy Operations Store Contract — Lane 8-R2A

**Status:** ACTIVE (implementation)  
**Scope:** Shared durable storage for Target policy operations only  
**Supersedes for persistence:** process-memory policy state and `/tmp` SQLite for policy ops

## Purpose

One **shared** `PolicyOperationsStore` backs every policy-operations consumer so owner reviews, scheduler transitions, health, and A2MCP agree on review state across Vercel instance lifecycle.

## Store contract

Interface: `src/policy/operations/contract.ts` (`PolicyOperationsStore`)

| Method | Behaviour |
|---|---|
| `ensureSchema` | Idempotent schema ensure |
| `ensureInitialized` | Idempotent seed of approved Target policy when missing |
| `getActiveRecord` / `upsertRecord` | Read/write versioned ops row |
| `ensureOwnerAlert` | Idempotent active alert by unique `alert_key` |
| `clearActiveOwnerAlerts` | Clear active alerts for policy version |
| `insertPendingReview` / `listPendingReviews` | Material-change pending records |
| `insertReviewEvent` / `listRecentReviewEvents` | Audit trail (no secrets) |
| `withTransaction` | Atomic scheduler/owner updates |

Business logic: `src/policy/operations/service.ts` (scheduler + owner review).

## Adapters

| Kind | Use |
|---|---|
| `postgres` | **Production required.** `POLICY_OPS_DATABASE_URL` or `DATABASE_URL` |
| `sqlite` | Local development / isolated tests only. Path must not be production `/tmp` |
| `memory` | Explicit unit tests only (`createMemoryPolicyStoreForTests`) |

### Forbidden in production

- Process-memory policy state as the live store  
- `/tmp` SQLite  
- Silent fallback from Postgres to memory or `/tmp`  
- Separate stores for A2MCP vs owner routes  

When Postgres URL is missing in production, the factory throws `PolicyStoreUnavailableError`. Routes report unavailable; they **do not** invent `CURRENT`.

## Consumers (must share factory)

- `POST /v1/agent`  
- `POST /v1/target-price-check`  
- `GET /health`  
- `GET /v1/owner/policy-status`  
- `POST /v1/owner/policy-review`  
- `POST /v1/owner/policy-scheduler`  
- Notices policy-warning banner (read path)  
- Scheduled policy-review logic  

Factory: `getPolicyOperationsStore()` / `tryGetPolicyOperationsStore()` in `src/policy/operations/factory.ts`.

## Schema

### Postgres

`POSTGRES_POLICY_OPS_SCHEMA_SQL` in `src/policy/operations/adapters/postgres-adapter.ts` — applied idempotently via `ensureSchema()`.

### SQLite (local)

Migrations `0004_policy_operations` + `0005_policy_operations_r2a` + adapter column ensure for:

- `created_at`, `state_version` on `policy_operations`  
- `previous_approved_state`, `detected_state`, `resolution` on pending reviews  
- `previous_state`, `resulting_state` on review events  

### Initialization seed (idempotent)

From approved Target contract (no `/tmp` migration):

- policy ID: `target-us-online-price-match-v1`  
- version: `v1`  
- approved/verified: `2026-07-19T18:00:00.000Z`  
- review state: `CURRENT`  
- source URL: official Target price-match guarantee  
- review interval: 24h  

## Auth

| Route | Secret |
|---|---|
| Owner review write | `OWNER_OPS_SECRET` |
| Scheduler | `CRON_SECRET` |
| Status read | either `OWNER_OPS_SECRET` or `CRON_SECRET` |

- Server-only env vars (never `NEXT_PUBLIC_*`)  
- Unauthorized → `401`  
- Missing secret config → `503`  
- No secret values or hashes in review events  

Public `/owner/policy` is **documentation only** (no unauthenticated durable-state dump).

## Runtime failure

When store unavailable:

- `/health`: `status: degraded`, `policy_ops_store: unavailable`, warning set; **not** fake `CURRENT`  
- Owner writes: `503` `policy_ops_store_unavailable`  
- A2MCP: no positive eligibility from unknown state (fail-closed policy path)  
- No DB credentials or connection strings in responses  

## Recovery / rollback

1. Restore `POLICY_OPS_DATABASE_URL` / `DATABASE_URL` if misconfigured.  
2. Re-run app boot → `ensureSchema` + `ensureInitialized` (safe).  
3. Do not drop production tables without backup.  
4. SQLite local: delete only non-production `data/nobu.policy-ops.sqlite` if resetting local state.  
5. Down migration `0005` removes marker only; column adds remain for SQLite safety.

## Hard locks

Target-only; no Agent `5541` / OKX listing changes; no SerpApi required for store ops; no claim submission; fail-closed matching unchanged.
