# AfterBuy Current State

**Date:** 2026-07-13  
**Status:** LANE 0 COMPLETE / PRE-IMPLEMENTATION BASELINE ADOPTED

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

## Lane 0 proof completed

- Source-of-truth pack adopted in the repository.
- Repository baseline adopted.
- `README.md`, `.gitignore`, and `.env.example` created.
- Required-file check passed.
- Secret-file and secret-pattern scans passed.
- No product implementation exists yet (no application source, Target policy engine, SerpApi client, matching, monitoring, UI, deployment, or OKX listing work).
- Tool workflow locked: ChatGPT for product/architecture/lane coordination; Grok Build for repository implementation; regular Grok research for external verification only.

## No product code proof exists yet

The deployment, API, scheduler, Target connector, SerpApi key, live query proof, OKX listing, demo, and submission are not yet complete unless later state updates explicitly prove them.

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

**Lane 1 — Domain schemas and deterministic contracts.**
