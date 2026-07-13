# AfterBuy Current State

**Date:** 2026-07-13  
**Status:** LANE 2 COMPLETE / TARGET POLICY ENGINE

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
- Target policy engine: deterministic evaluation bound to `target-us-online-price-match-v1` (YAML + code snapshot); no refund guarantees.

## Lane 0 proof completed

- Source-of-truth pack adopted; baseline README, `.gitignore`, `.env.example`.
- Secret and required-file checks passed.
- Grok Build locked as primary implementation agent.

## Lane 1 proof completed

- Domain schemas, locked enums, DB migration, pure unit/migration tests.

## Lane 2 proof completed

- Deterministic Target policy engine implements online-channel and supported-geography checks.
- 14-day calendar window with day 0, day 14 (in window), and day 15 (expired) boundaries.
- Known exclusions (Target Plus, clearance, preorder, coupon/bonus ambiguity, unknown labels) fail closed.
- Missing channel, date, receipt evidence, and unlocked fingerprint fail correctly.
- Stale policy (>24h since verified_at or forced) returns `POLICY_STALE`.
- Results bind `policy_id`, `policy_version`, `policy_verified_at`, and `final_decision_by: Target`.
- Full Target policy fixture matrix and date unit tests pass.
- No SerpApi calls, matching engine, scheduler, UI, deployment, or OKX work.

## No live provider proof yet

The live SerpApi connector, capability audit, matching engine, deployment, A2MCP public endpoint, OKX listing, demo, and submission are not yet complete unless later state updates explicitly prove them.

## Remaining later gates

1. Create a SerpApi account/key; provider terms apply.
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

**Lane 3 — SerpApi connector and live capability audit.**
