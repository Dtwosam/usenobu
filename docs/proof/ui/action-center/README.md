# Sprint B — Action Center

**Date:** 2026-07-14  
**Verdict:** `NOBU_REVIEW_SAFE_B_PASS`  
**Production:** https://usenobu.vercel.app  
**Lane 8:** `NOBU_LANE_8_PENDING_REVIEW` (ASP #5541) — not completed.

## Goal

When Nobu finds a valid possible price difference, give a simple, safe next step.

## Default UI

### Possible price difference

Facts (≤4):

1. Purchase price  
2. Observed price  
3. Potential difference  
4. Days remaining  

Trust note: *Third-party observed price. Target verifies and decides.*

Actions:

- Primary: **Open on Target** (HTTPS Target URL from locked fingerprint only)
- Secondary: **Contact Target** → `https://www.target.com/help/contact-us`
- Secondary: **Copy details**
- Quiet: **View details**

## Target URL validation

`src/web/target-url.ts`

- HTTPS only  
- Target domain only  
- Tied to fingerprint / purchase product URL  
- Never SerpApi or unknown sellers  
- Hidden when untrusted  

## Official contact

Reverified 2026-07-14: [Target Contact Us](https://www.target.com/help/contact-us)  
Phone still documented: 1-800-591-3869 (Guest Services).  
Registry: `TARGET-CONTACT` in `docs/external-source-registry.md`.

Does **not** log in, submit claims, or auto-start chat.

## Copy details

Approved fields only (product, dates, prices, difference, observation time, deadline, URL/ID, SerpApi third-party source) + closing:

*Confirm the current price on Target.com. Target verifies the price and makes the final decision.*

Success: *Details copied.*

## Fixture / live

Stored observation detection (`resolveStoredDataSource`):

- Fixture query / hash / title → always show *Test data — not a live current retailer price.*  
- Live SerpApi observations → no fixture banner  

## Implementation files

| File | Role |
|---|---|
| `src/web/action-center.ts` | Model, copy, visibility, data source |
| `src/web/target-url.ts` | Trusted URL + contact constant |
| `app/.../alerts/[alertId]/page.tsx` | Compact result UI |
| `app/.../alerts/[alertId]/ActionCenter.tsx` | Client actions |
| `src/web/purchase-service.ts` | `getAlert` loads observation + fingerprint |

## Tests

| Suite | Result |
|---|---|
| `tests/web/action-center.test.ts` | pass |
| `npm test` | 208 passed |
| typecheck / build | pass |
| `npm run test:e2e` | 28 passed, 2 skipped |
| Secret scan | PASS |
| Production smoke | see `prod-proof.json` |

E2E screenshots (fixture-labelled): `desktop-action-center-fixture-e2e.png`, `mobile-action-center-fixture-e2e.png`.

## Hard locks

Agent **5541**, `POST /v1/agent`, matching/policy/monitoring unchanged. No ASP resubmit.
