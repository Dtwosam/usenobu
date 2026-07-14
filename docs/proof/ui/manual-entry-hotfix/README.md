# Nobu UI Hotfix 1 — Manual purchase entry disclosure

**Date:** 2026-07-14  
**Verdict:** `NOBU_UI_HOTFIX_1_PASS`  
**Production:** https://usenobu.vercel.app/purchases/new

## Root cause

In `app/purchases/new/PurchaseIntake.tsx`:

1. `showManual` was initialized to **`true`**, so the structured form was always visible.
2. The secondary control only called **`setShowManual(true)`** and never collapsed, so it appeared broken once the form was open.

Not an overlay, missing `type="button"`, or pointer-events issue on the control itself.

## Repair

- Default `showManual` to **`false`** (open automatically only when returning with a server validation error).
- Real **toggle**: open → focus first field + label **Hide manual form**; hide → collapse without clearing values.
- Accessible button: `type="button"`, `aria-expanded`, `aria-controls="purchase-manual-form"`.
- AI success and AI failure still expand the manual form; NL text is preserved on failure.

## Production smoke (`prod-smoke.json`)

| Check | Result |
|---|---|
| Form hidden initially | Yes (`form_count: 0`) |
| Label `Enter details manually` | Yes |
| `aria-expanded=false` initially | Yes |
| Click opens form | Yes |
| Label becomes `Hide manual form` | Yes |
| Values survive collapse/reopen | Yes (`15.55` / `Preserve me`) |
| Keyboard Enter opens form | Yes |
| No overflow at 320px | Yes |

Screenshots: `01-initial-collapsed.png`, `02-manual-open.png`, `03-reopen-preserved.png`, `04-mobile-320-open.png`.

## Tests run

- Targeted UI unit tests
- `npm test` (171)
- `npm run typecheck`
- `npm run build`
- `npm run test:e2e` (28 passed, 2 skipped)
- Secret scan: PASS

## Lane 8

Unchanged: **NOBU_LANE_8_PENDING_REVIEW** (ASP #5541 under marketplace review).
