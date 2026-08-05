# Lane 7.3A.1 — Adaptive product discovery

**Verdict:** `NOBU_LANE_7_3A_1_PASS`

**Runtime implementation commit:** `b2d99b2d8036dcc813bb4d861a31484663c60fbe`
**Closeout commit (residual copy + tests + proof):** `bf803453de39a6c112c8c71c688378761e36caec`
**Final repository HEAD after this docs refresh:** recorded at push time (docs-only if separate)

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

## Deployment

### Final production (2026-07-20 closeout redeploy)

| Item | Value |
|---|---|
| Deployment ID | `dpl_6ymuDrXsEhzjteQo5r3qJw5PxK85` |
| Unique production URL | https://usenobu-q8b2rrhqj-dtwoflicks-2878s-projects.vercel.app |
| Status | Ready |
| Created | 2026-07-20T09:51:51Z (local) |
| Deployed source | final closeout HEAD including residual error-copy + adaptive runtime |
| Canonical | https://www.usenobu.xyz → **this** deployment (re-aliased after `--prod` auto-bound `afterbuy.vercel.app`) |
| `afterbuy.vercel.app` | **removed** after deploy; HTTP **404** |

### Prior Grok production (historical)

| Item | Value |
|---|---|
| Deployment ID | `dpl_45D4kWZijbj2HGdSXQE3jpgBqK8k` |
| Unique production URL | https://usenobu-63qlryu08-dtwoflicks-2878s-projects.vercel.app |
| Unique preview | https://usenobu-i4dsbjtbw-dtwoflicks-2878s-projects.vercel.app |
| Note | First adaptive-runtime production; superseded by closeout redeploy |

**Distinction:** adaptive product discovery **runtime** landed in `b2d99b2`. Closeout `bf80345` adds residual error-copy, date-stable A2MCP tests, and proof. Canonical production was redeployed from the closeout commit so live code matches HEAD (except any pure docs-only commit after redeploy).

## ASP #5541 (read-only, 2026-07-20)

| Field | Value |
|---|---|
| Name | Nobu |
| Endpoint | `https://www.usenobu.xyz/v1/agent` |
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
