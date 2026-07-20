# Lane 7.3A.1 — Adaptive product discovery

**Verdict:** `NOBU_LANE_7_3A_1_PASS`

**Runtime implementation commit:** `b2d99b2d8036dcc813bb4d861a31484663c60fbe`  
**Proof/docs commit (original):** `70491a2a0bc6b74a59687dade8b53afe6172216e`  
**Closeout verification:** 2026-07-20 — local re-verification + residual fixes; see commits after this README update.

## Corrected user journey

1. Open `/purchases/new` — one product-details section (no mode choice).
2. Enter price, date, and any product clue (title, URL, TCIN, model, UPC…).
3. Find my product is disabled until a usable clue exists.
4. Nobu adaptively returns one strong candidate, 3–5 multi-candidates, or no-results.
5. User selects (when multi) and always explicitly confirms before monitoring.

## Removed interface

- How do you want to identify the product?
- Exact product / Help me find the product mode selector
- Mode-specific duplicated fields

## Candidate-selection UI

- Desktop: two-column `.n-candidate-grid`
- Mobile: one-column cards + sticky continue action
- Radio selection, `Selected` label, continue disabled until a strong pick
- Selection does not auto-confirm; final confirm stage still required
- Weak/title-only shows warning and cannot lock monitoring
- `None of these — edit my details` returns to the form with entered details
- No-results empty state with edit/retry

## Local proof (2026-07-20 re-run)

| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm test` | **323 passed**, 1 skipped |
| A2MCP suite | pass (frozen `now` for 14-day window; no product-logic change) |
| `npm run build` | pass |
| Playwright `adaptive-discovery.spec.ts` | **3 passed** |
| Playwright `consumer-flow.spec.ts` | **10 passed** |
| `git diff --check` | clean |
| Secret scan (lane files) | clean |
| `afterbuy` in app/src/tests | **zero** matches |
| Unrelated `docs/proof/ui/screens/*` screenshot churn | restored (not committed) |

## Live vs fixture proof

| Kind | What was proven |
|---|---|
| **Live production** | Canonical + unique `/purchases/new` JS bundle: product-details present; mode selector / “Help me find” / `mode-exact` **absent**; `/health` 200; `/v1/agent` responds; no secrets/afterbuy brand in page bundle |
| **Deterministic fixture (local e2e)** | Button gating; multi 3–5 candidates; no preselection; radio + Selected; continue then explicit confirm; monitoring after lock; mobile no horizontal overflow; single strong path |

Live provider ambiguity was **not** fabricated. Multi-candidate selection UI is proven with the labelled fixture scenario in Playwright.

## Deployment (Grok-era production, still canonical at closeout start)

| Item | Value |
|---|---|
| Deployment ID | `dpl_45D4kWZijbj2HGdSXQE3jpgBqK8k` |
| Unique production URL | https://usenobu-63qlryu08-dtwoflicks-2878s-projects.vercel.app |
| Status | Ready |
| Created | 2026-07-19T22:59:53.712Z |
| Deployed runtime | Lane 7.3A.1 implementation (`b2d99b2` timing; adaptive bundle present) |
| Canonical | https://usenobu.vercel.app → same deployment |
| Unique preview (earlier) | https://usenobu-i4dsbjtbw-dtwoflicks-2878s-projects.vercel.app |
| `afterbuy.vercel.app` | not a live alias (HTTP 404); not present in `vercel alias ls` as usenobu mapping |

If a later commit only contains proof/docs or residual copy/tests, distinguish:

- **Deployed runtime commit** (adaptive product discovery code)
- **Final repository HEAD** (may include verification fixes and proof refresh)

## ASP #5541 (read-only, 2026-07-20)

| Field | Value |
|---|---|
| Name | Nobu |
| Endpoint | `https://usenobu.vercel.app/v1/agent` |
| Fee | `0` |
| Approval | Listing under review (`approvalStatus` / display **2**) |
| Mutation | **None** — no edit, resubmit, or new ASP |

## Screens

- `screens/desktop-multi-unselected.png`
- `screens/desktop-multi-selected.png`
- `screens/desktop-single-confirm.png`
- `screens/mobile-multi-selected-sticky.png`

## Next

**Lane 8 — reviewer-status monitoring.**  
Lane 7.3B consented email notifications remains queued separately.
