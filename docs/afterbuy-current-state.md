# AfterBuy Current State

**Date:** 2026-07-13  
**Status:** LANE 6 COMPLETE / CONSUMER WEB FLOW

## Locked decisions

- Product: consumer price-drop protection, not a merchant Shopify app.
- Retailer: Target.com online only; Target Plus and AK/HI unsupported.
- Price source: SerpApi Google Shopping — **third-party observed data**, never official Target API.
- Demo web path uses **clearly labelled fixtures** (never presented as live).
- Match: fail-closed; user confirms once; locked fingerprint required before monitoring.
- No retailer login, claim submission, card/bank/password/2FA collection.
- No refund guarantees; Target verifies and decides.
- Primary implementation agent: Grok Build.

## Lanes 0–5 proof completed

- Source pack, schemas, policy engine, SerpApi connector + live audit, matching, monitoring loop.

## Lane 6 proof completed

### Consumer web (Next.js App Router)

| Route / flow | Status |
|---|---|
| Home + notices (supported cases, provenance, privacy, Target steps) | Done |
| Add purchase (Target online, USD, no sensitive fields) | Done |
| Candidate review / confirm (fail-closed ambiguous & title-only) | Done |
| Monitoring dashboard + price history + demo check | Done |
| Alert/result page + official Target action guidance | Done |
| Fixture banners on all data-bearing screens | Done |

### Browser E2E (Playwright)

- Add → review → confirm → monitor → alert path **passes**
- Ambiguous fixture cannot confirm
- No-price fixture shows empty candidates
- Alaska unsupported path blocked
- Notices page privacy/provenance content verified
- Sensitive strings (password/card/cvv) not exposed on alert path

### Commands

- `npm run dev` — local web app
- `npm test` — unit/domain tests
- `npm run test:e2e` — browser proof (fixture mode)

### Explicit non-scope

- No public HTTPS A2MCP endpoint, rate-limit productization, or OKX listing (Lane 7+).

## Remaining later gates

1. Free A2MCP endpoint + public HTTPS + curl proof (Lane 7).
2. OKX ASP registration/listing (Lane 8).
3. Demo and submission closeout (Lane 9).

## Next active lane

**Lane 7 — Free A2MCP endpoint.**
