# Nobu Production Deployment and Stale-Session Differential Audit

**Date:** 2026-07-15
**Public alias:** `https://www.usenobu.xyz`
**Verdict:** `NOBU_PRODUCTION_SESSION_DIFFERENTIAL_PASS`

## Primary root-cause verdict

**`OLD_COPY_STILL_REACHABLE`**

Secondary factors (not primary):

- Pre-repair demo identity (`Example Widget` / TCIN `87654321`) could still be submitted and reach ambiguity, which then surfaced the hard-coded cannot-confirm sentence.
- Prior production deployment `dpl_6PSo3ihPaHYhJZe9ykxPAp6A5nQS` (`usenobu-csmixy8hi`) already contained both the new `enrollmentAmbiguityCopy` notice **and** the old cannot-confirm string (same as repo HEAD `40e9e89`). Clean AirTag already passed before this repair; the user-visible old sentence remained reachable on the ambiguity cannot-confirm branch.

## Gate 1 — Live code

| Item | Value |
|------|--------|
| Pre-repair public deployment ID | `dpl_6PSo3ihPaHYhJZe9ykxPAp6A5nQS` |
| Pre-repair URL | `usenobu-csmixy8hi-dtwoflicks-2878s-projects.vercel.app` |
| Post-repair public deployment ID | `dpl_J7qjuJNdFU8asHJ1BTugNNkHLkMW` |
| Post-repair URL | `usenobu-r1li51clj-dtwoflicks-2878s-projects.vercel.app` |
| Aliases after repair | `www.usenobu.xyz`; retired legacy alias also reached the same deployment at the time of that historical audit |
| Repo HEAD at audit start | `40e9e89` |
| Old sentence still in source at start | Yes — `app/purchases/[id]/review/page.tsx` cannot-confirm hard-code |
| Bundle static search for old/new | Server-rendered; not present in static HTML chunks (expected) |

## Gate 2 — Session differential (public alias)

### A. Clean browser (no cookies)

| Field | Result |
|-------|--------|
| URL | `https://www.usenobu.xyz/purchases/pur_952082b4823f/review?title=Apple+AirTag&source=LIVE` |
| Identifiers | TCIN `54191097`, AirTag URL/title — survived |
| Decision | `EXACT_MATCH_CANDIDATE` |
| Candidates | 1 |
| Old copy | **not visible** |
| Screenshot | `A-clean-session.png` |

### B. Stale demo defaults

| Field | Result |
|-------|--------|
| Submit identity | Example Widget / `87654321` / demo URL |
| Result URL | `/purchases/new?error=outdated_demo_draft&...` |
| Form after | identity fields cleared |
| Review contamination | none |
| Old copy | **not visible** |
| Message | “Saved draft was outdated” / “Your saved draft was outdated. Please add the purchase again.” |
| Screenshot | `B-stale-session.png` |

### C. Stale then fresh AirTag overwrite

| Field | Result |
|-------|--------|
| Decision | `EXACT_MATCH_CANDIDATE` |
| Demo contamination | none |
| Old copy | **not visible** |
| Screenshot | `C-stale-then-fresh.png` |

Artifacts: `gate2-sessions.json`, screenshots above.

## Gate 3 — Diagnostics (no secrets)

`submitPurchaseAction` logs structured fields only:

- `purchase_id`, `data_source`, `decision`, `reasons` (capped), `candidate_count`
- booleans: `has_tcin`, `has_model`, `has_target_url`
- `title_len` (length only)

No SerpApi keys, full cookies, or free-text purchase dumps.

## Repair made

1. **Cannot-confirm** uses `enrollmentAmbiguityCopy` — never hard-codes “Add a model, TCIN or UPC” when identifiers are present.
2. **`src/web/demo-defaults.ts`** — detect/scrub Example Widget / `87654321` / `WDG-100` / demo URL; session snapshot version `2`.
3. **Live `createPurchaseFlow`** — scrub demo defaults; reject pure demo drafts with `outdated_demo_draft` (fixture gate unchanged).
4. **Cookie hydrate** — drop unconfirmed demo drafts only; never erase confirmed fingerprints.
5. **Error copy** for outdated draft + safer review error next-action.
6. Deployed working tree to production and assigned **`www.usenobu.xyz`**.

## Production proof summary

| Check | Result |
|-------|--------|
| Clean Incognito AirTag | PASS — exact match, IDs survive, no old copy |
| Stale demo session | PASS — rejected/migrated, no old copy |
| Fresh-over-stale | PASS |
| `/health` | ok, SerpApi + Groq configured (booleans only) |
| `POST /v1/agent` UNDERSTAND_PURCHASE | 200 CONFIRMATION_REQUIRED |
| Secret scan (source patterns) | no committed secrets found |
| Unit tests | 253 passed |
| typecheck / build | pass |

## Provider calls

- Gate2 clean live discovery: 1
- Gate2 migrated live discovery: 1
- Stale demo: 0 (rejected before provider)
- Agent UNDERSTAND: 1 (Groq)

## Lane 8

Unchanged — still pending external review. ASP **5541** / free A2MCP listing path not modified by this repair.

## Remaining blockers

- Lane 8 external submission/review remains open.
- Full historical Lane 7.5E UI home-copy assertion set may still report BLOCKED if marketing strings drift; not in scope for this differential.

## Commit

See git after commit: `Fix Nobu stale production discovery sessions`
