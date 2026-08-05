# Find my product production repair (Lane 7.5D.1)

## Root cause

**Exception (Vercel production logs):**

```text
Error: ENOENT: no such file or directory, scandir '…/migrations'
```

**Failing path:** `src/db/migrator.ts` → `listMigrations()` / `fs.readdirSync(MIGRATIONS_DIR)`
**Call chain:** `submitPurchaseAction` → `createPurchaseFlow` → `getWebDatabase()` → `migrateUp()` → scandir migrations

On Vercel the SQL migration directory was not available next to the compiled module, so the first write to SQLite crashed the server action and Next.js showed a blank *Application error* page (digest `2288372432`).

Secondary production risks also addressed:

1. Writable DB path: app filesystem is read-only; use `/tmp/nobu.web.sqlite` when `VERCEL=1`.
2. Multi-instance demo continuity: cookie snapshot of demo DB state after mutations.

## Why earlier proof missed it

Prior lanes verified static routes (`/`, `/health`, notices) and local E2E with filesystem migrations present. They did **not** execute the production **Find my product** server action against a real serverless filesystem.

## Repair

- Embed migrations in `src/db/embedded-migrations.ts` (no runtime scandir required).
- Prefer embedded SQL in `migrateUp` / `migrateDown`.
- Resolve Vercel DB path under `/tmp`.
- Cookie hydrate/persist for demo purchases across instances.
- Server actions catch unexpected errors and redirect to plain-language form errors (values preserved).

## Production browser proof (2026-07-13)

URL: **https://www.usenobu.xyz**

| Step | Result |
|---|---|
| Homepage → Track a purchase | OK |
| Find my product (exact_match fixture) | POST 303 → review 200 |
| No application-error page | Pass |
| Match decision EXACT_MATCH_CANDIDATE | Pass |
| Unsupported AK form error | Pass (no blank page) |
| Material console errors | None |
| Server logs unhandled exception | None for successful path |

Artifacts:

- `01-form-before-submit.png`
- `02-review-after-submit.png`
- `03-unsupported-ak.png`
- `browser-console.json`
- `vercel-log-snippet.txt`
