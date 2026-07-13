# AfterBuy Current State

**Date:** 2026-07-13  
**Status:** LANE 1 COMPLETE / DOMAIN SCHEMAS AND DETERMINISTIC CONTRACTS

## Locked decisions

- Product: consumer price-drop protection, not a merchant Shopify app.
- Retailer: Target.
- Channel: Target.com / Target online purchases only.
- Price source: SerpApi Google Shopping API.
- SerpApi classification: provisional third-party observation source.
- Match model: user confirms exact product once; later checks use a locked fingerprint.
- Policy window: up to 14 days after purchase, subject to Target's current policy and exclusions.
- ASP: free A2MCP first.
- Primary category: Lifestyle Companion.
- Primary repository implementation agent: Grok Build (lane by lane).
- Regular Grok research: public discussion, competition, and external-change verification only; does not override official sources.
- Domain contracts: Zod schemas in TypeScript; local migration proof via Node `node:sqlite` with equivalent tables (production target remains PostgreSQL per architecture).

## Lane 0 proof completed

- Source-of-truth pack adopted in the repository.
- Repository baseline adopted.
- `README.md`, `.gitignore`, and `.env.example` created.
- Required-file check passed.
- Secret-file and secret-pattern scans passed.
- Tool workflow locked: ChatGPT for product/architecture/lane coordination; Grok Build for repository implementation; regular Grok research for external verification only.

## Lane 1 proof completed

- Minimal TypeScript + Vitest + Zod tooling added (no secrets required).
- Purchase input, Target product candidate, locked fingerprint, price observation, evidence provenance, and Target policy result schemas implemented.
- Locked product/provider/result status enums implemented and tested.
- Initial migration for `purchases`, `product_matches`, `price_observations`, and `policy_versions` applies cleanly, is idempotent on re-run, and is reversible then re-applicable.
- Schema validation tests pass (invalid prices, dates, currencies, incomplete fingerprints fail closed).
- No SerpApi network calls, matching engine, policy engine, scheduler, UI, deployment, or OKX work.

## No product runtime proof yet

The live SerpApi connector, Target policy engine execution, matching engine, deployment, A2MCP public endpoint, OKX listing, demo, and submission are not yet complete unless later state updates explicitly prove them.

## Remaining later gates

1. Create a SerpApi account/key; no retailer partner approval is required, but the provider's terms apply.
2. Select at least one Target.com product with stable identifiers for a live proof.
3. Prove that SerpApi returns a Target offer for that product in the chosen U.S. location.
4. Prove exact product matching and fail-closed behavior.
5. Deploy a free A2MCP endpoint and submit it for OKX review early.
6. Complete demo, X post, and official submission before the deadline.

## Risk register snapshot

- Google Shopping may omit Target, return stale data, or mix sellers.
- A query can match the wrong model/variant.
- Target can change policy or exclude an offer.
- Target must independently verify the lower price.
- The SerpApi free plan is capacity-limited and lacks the U.S. Legal Shield included with higher recurring plans.
- Hackathon approval timing can consume the remaining deadline window.

## Next active lane

**Lane 2 — Target policy engine.**
