# Sprint C — Judge Clarity and User Validation

**Date:** 2026-07-14  
**Verdict:** `NOBU_REVIEW_SAFE_C_PASS`  
**Production:** https://usenobu.vercel.app  
**Lane 8:** `NOBU_LANE_8_PENDING_REVIEW` (ASP #5541) — not completed.

## Homepage copy (locked)

### Hero
**Nobu watches prices after you buy.**

> Add a recent purchase once. Nobu monitors the exact product and alerts you when the price drops—so you can request the difference back.

- Primary: **Add a purchase** → `/purchases/new`
- Secondary: **How it works** → `#how-it-works`

Hero is **retailer-neutral** (no Target in the hero).

### How it works
1. **Add your purchase** — Tell Nobu what you bought and confirm the exact product.  
2. **Nobu keeps watch** — Nobu checks the confirmed item during the monitoring window.  
3. **Request the difference** — See how much you may be able to get back and what to do next.

### Currently supported
- Eligible Target.com purchases  
- Exact-product matching fails closed  
- Prices observed through a third-party source  
- Target verifies and decides  

Supporting: *Nobu is starting with eligible Target.com purchases.*  
Link: **Supported purchases** → `/notices`

### Trust (retailer-neutral)
- Exact-product matching fails closed.  
- Prices come from a third-party observation source.  
- The retailer verifies the price and decides.

## Money-back / no-guarantee proof
- Benefit language: *request the difference back* / *may be able to get back*  
- Forbidden guarantees not present on homepage  
- Target workflow still states Target verifies and decides (alert / Action Center)

## Judge path
1. Homepage  
2. Add a purchase  
3. Confirm exact product  
4. Monitoring Proof  
5. Check price now  
6. Action Center (only if valid lower price)  

No demo route. No auto-fixtures presented as live.

## User testing
- Kit: `docs/user-testing/nobu-final-usability-kit.md`  
- Evidence: `docs/proof/user-testing/final-validation/` — **`READY_FOR_REAL_TESTERS`**  
- Real testers completed: **0** (none fabricated)

## Screenshots
- `desktop-home.png`  
- `mobile-home-390.png` / `mobile-home-320.png`  
- `axe-home.json`

## Tests
- Positioning unit tests  
- Homepage e2e clarity  
- Full unit + e2e suite  
- Secret scan  
- Production smoke  
