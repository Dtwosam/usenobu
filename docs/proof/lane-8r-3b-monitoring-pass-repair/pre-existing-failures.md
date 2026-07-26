# Pre-existing suite failures — baselined, not caused by Lane 8R.3B

> **Resolved in Lane 8R.3B.1 (2026-07-26).** All 19 failures recorded below are
> fixed; the full suite is now **55 files passed · 453 passed | 1 skipped
> (454)**. The date fixtures moved to the shared relative helper
> `tests/helpers/test-dates.ts`, and the two frozen migration-list assertions
> now derive the expected ids from `listMigrationSql()` instead of a literal.
> No production behaviour and no policy-window logic changed. The record below
> is kept as the baseline evidence that these failures pre-dated the lane.

## Method

The full unit suite was run with the lane's changes applied, then the entire working tree was stashed (`git stash push --include-untracked`) to return to clean `32ddaa0`, and the same six failing files were re-run.

## Result

| Run | Result |
|---|---|
| Full suite **with** Lane 8R.3B changes | `Test Files 6 failed | 49 passed (55)` · `Tests 19 failed | 434 passed | 1 skipped (454)` |
| Same six files at clean `32ddaa0` (lane stashed) | `Test Files 6 failed (6)` · `Tests 19 failed | 29 passed (48)` |

**Identical failure count — 19 — with and without the lane.** No regression was introduced.

## Failing files (all pre-existing)

- `tests/auth/passwordless-auth.test.ts`
- `tests/db/embedded-migrations.test.ts`
- `tests/matching/store.test.ts`
- `tests/web/agent-preflight.test.ts`
- `tests/web/purchase-lifecycle.test.ts`
- `tests/web/purchase-privacy.test.ts`

## Causes

1. **Hardcoded-date time bomb (majority).** Fixtures pin `purchase_date` to fixed 2026-07 dates. Those dates have now aged past Target's price-adjustment window, so eligibility-gated setup returns `WINDOW_EXPIRED` and the fixtures' `expect(created.ok).toBe(true)` fails. Nothing about the code under test changed — only the wall clock.
2. **`tests/matching/store.test.ts`** additionally carries the long-known hardcoded-migration-list assertion, recorded as pre-existing and out of scope as far back as Lane 7.4D.

## What this lane fixed, and what it left alone

Fixed — only where this lane's own proof depends on it, by deriving the purchase date relative to today:

- `tests/payments/start-monitoring.test.ts`
- `tests/payments/okx-seller-adapter.test.ts`
- `tests/payments/monitoring-pass.test.ts` (new, written relative from the start)

That turned `tests/payments/` from **14 failing** at baseline to **47 passed / 47**.

Left alone — the six files above are outside this lane's scope, and widening into them would have violated "focused changes and tests only". They are worth a dedicated cleanup lane: the fixtures should derive dates relative to `now` rather than pinning them.
