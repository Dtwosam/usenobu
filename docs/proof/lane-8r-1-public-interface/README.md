# Lane 8R.1 — Public website and interface alignment

**Verdict:** `NOBU_LANE_8R_1_PASS`  
**Date:** 2026-07-20  
**Base commit:** `c95e266f76563e4572a64a5f3b01f140a4bb61ff`  
**Sequence:** `8R.0 → 8R.1 → 8R.2 → 8R → 7.4G`

## Scope

Website and interface only. Align the public UseNobu experience with the truth boundary:

> An AI agent that monitors the exact product after purchase and alerts the customer when a safely matched lower price may create an opportunity to request the difference from the retailer.

Access paths: UseNobu website + OKX.AI (compatible AI-agent environments).

## Changed routes

| Route | Change |
|---|---|
| `/` | Five-section homepage (hero, how it works, scenario, access, trust) |
| `/okx` | New customer OKX.AI guide (setup, $0.99, management, FAQ, resources) |
| `/notices` | Concise notices including OKX payment and retailer decision |
| `/purchases/new` | Intro + exact-product help panel |
| `/dashboard` | My purchases empty state + CTAs |
| `/purchases/[id]` | Possible price difference states + monitoring labels |
| `/purchases/[id]/alerts/[alertId]` | Action Center order and truthful labels |
| `/purchases/[id]/review` | Exact-product confirmation copy |

## Shared modules

- `src/web/okx-marketplace.ts` — single marketplace href resolver (`NEXT_PUBLIC_OKX_MARKETPLACE_URL` HTTPS → external; else `/okx`)
- `src/ui/OkxMarketplaceLink.tsx` — all OKX CTAs
- `src/ui/Header.tsx` / `src/ui/Footer.tsx` — global nav and three footer groups
- `app/globals.css` — Manrope type scale, layout tokens (1160 / 720 / 760)

## Proof checklist

| # | Check | Result |
|---|---|---|
| 1 | Homepage ≤ five main sections | PASS (Playwright + unit) |
| 2 | No hackathon/judge language on public pages | PASS |
| 3 | Primary CTA → `/purchases/new` | PASS |
| 4 | OKX CTAs use one config source | PASS |
| 5 | `/okx` desktop + mobile | PASS |
| 6 | Typography/spacing tokens match system | PASS (CSS tokens + build) |
| 7 | No mobile horizontal overflow | PASS (320 / 390) |
| 8 | Purchase detail uses Possible price difference | PASS (copy) |
| 9 | Action Center truthful | PASS |
| 10 | No “Nobu recovers money” claims | PASS |
| 11 | No guarantee language | PASS |
| 12 | Existing purchase/monitoring behavior intact | PASS (typecheck/build; no domain changes) |
| 13 | No secrets/payment signatures exposed in UI | PASS (scan) |

## Tests run

```
npx vitest run tests/ui/positioning.test.ts tests/ui/status-copy.test.ts \
  tests/web/action-center.test.ts tests/web/okx-marketplace.test.ts
# 27 passed

npx playwright test tests/e2e/homepage-clarity.spec.ts
# 5 passed

npm run typecheck  # pass
npm run build      # pass; /okx route present
git diff --check   # clean (CRLF warnings only)
```

## Scans

### Forbidden copy (public UI sources)

Scanned: homepage, okx, notices, intake, header/footer, action center, status-copy, marketplace module.

Patterns: hackathon, judge, competition, submission, recover your money, nobu gets your money, make money with nobu, guaranteed savings, automatic refund, claim secured.

**Result:** No customer-facing hits.  
Note: `src/web/action-center.ts` retains `/automatic refund/i` inside `COPY_FORBIDDEN_PATTERNS` (reject list only).

### Sensitive output

Scanned for payment signatures, private keys, SerpApi keys, settlement refs.

**Result:** No secrets exposed in UI.  
Note: naive substring match on `X-PAYMENT` can false-positive on `okx-payment` test ids; those are not payment headers.

## Screenshots

- `screenshots/desktop-home.png`
- `screenshots/desktop-okx.png`
- `screenshots/desktop-notices.png`
- `screenshots/mobile-home-320.png` / `mobile-home-390.png`
- `screenshots/mobile-okx-320.png` / `mobile-okx-390.png`
- `axe-home.json` / `axe-okx.json` (no critical/serious)

## Typography / spacing verification

| Token | Value |
|---|---|
| Hero desktop | 56px / 60px weight 700 |
| Section desktop | 36px / 44px weight 700 |
| Card | 22px / 30px weight 600 |
| Lead | 19px / 30px |
| Body | 16px / 26px |
| Support | 14px / 21px |
| Container main | 1160px |
| Long-form | 720px |
| OKX guide | 760px |
| Desktop section gap | 88px |
| Card pad | 28px desktop / 20px mobile |
| Control min height | 48px |

## Marketplace config proof

- Absent / invalid / non-HTTPS `NEXT_PUBLIC_OKX_MARKETPLACE_URL` → `/okx`, `external: false`
- Valid HTTPS URL → that URL, `external: true` (new tab via `OkxMarketplaceLink`)
- Label always: `Use Nobu with OKX.AI`
- No “coming soon” / “pending approval” wording

## Deployment

| Item | Value |
|---|---|
| Product commit | `354cdb1` — Align Nobu public website experience |
| Proof HEAD | see `deployment.json` (includes deployment evidence commits) |
| Deploy URL | `https://usenobu-kgwmhx0dw-dtwoflicks-2878s-projects.vercel.app` |
| Deploy ID | `dpl_3EHNRYBmztioAGxwJRtT8FJWDUQ2` |
| Aliases | `usenobu.vercel.app`, `www.usenobu.xyz`, `usenobu.xyz` |

External verify (all HTTP 200 unless noted):

- `/` — new hero, five sections, no forbidden language
- `/okx` — guide live; marketplace CTAs fall back to `/okx`
- `/notices` — OKX payment + retailer decision copy
- `/purchases/new` — intake + exact-product help
- `/health` — OK
- free `POST /v1/agent` — responds (UNDERSTAND_PURCHASE)

See `deployment.json`.

## Explicit non-actions

- No ASP `#5541` edit or resubmit
- No genuine payment
- No live SerpApi in this lane’s proof suite
- No broad documentation rewrite (Lane 8R.2)
