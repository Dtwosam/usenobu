# Nobu Active Build Order

**Status:** ACTIVE BUILD ORDER  
**Date:** 2026-07-13

The build proceeds lane by lane. A lane closes only when its required proof passes.

## Lane 0 — Source-of-truth adoption and repository baseline

- Add this pack to the repository.
- Create baseline README and environment example.
- Record framework/database/deployment choices in an ADR if they differ from the reference stack.
- Confirm clean git status.
- No product implementation yet.

**Proof:** required files present; mandatory-doc check; no secrets.

## Lane 1 — Domain schemas and deterministic contracts

- Purchase input schema.
- Product candidate and locked fingerprint schema.
- Price observation schema.
- Target policy result schema.
- Status enums.
- Database migrations.
- Pure unit tests.

**Proof:** schema validation and migration tests pass.

## Lane 2 — Target policy engine

- Implement supported online channel and geography.
- Implement 14-day calculation.
- Implement exclusions represented in user input/data.
- Implement fail-closed unknown conditions.
- Bind responses to policy ID/version.

**Proof:** full Target policy fixture matrix passes.

## Lane 3 — SerpApi connector and live capability audit

- Add server-side client.
- Normalize Google Shopping response.
- Add safe error/rate-limit handling.
- Run a bounded live query for a selected Target product.
- Record whether a Target offer, stable identifiers, price, URL, seller, and timestamp are available.
- Do not implement optimistic matching until the live audit proves available fields.

**Proof:** redacted live response fixture, field report, search-count record, no key leakage.

## Lane 4 — Candidate matching and product confirmation

- Generate Target-only candidates.
- Implement strong identifier/model matching.
- Require user confirmation before monitoring.
- Store locked fingerprint.
- Reject title-only and ambiguous matches.

**Proof:** exact match, wrong model, wrong seller, Target Plus, ambiguous, and variant mismatch tests pass.

## Lane 5 — Price monitoring loop

- Active-window selection.
- Search-budget guard.
- Scheduled/manual check runner.
- Price observation history.
- Lower-price detection.
- Expiry handling.
- Idempotent repeated checks.

**Proof:** simulated price drop produces one alert; replay does not duplicate it; expired purchase is not checked.

## Lane 6 — Consumer web flow

- Add purchase.
- Review/confirm candidate.
- Monitoring dashboard.
- Alert/result page.
- Target official action instructions.
- Supported-case and privacy notices.

**Proof:** end-to-end browser path using real provider data where available and clearly labelled fixtures where not.

## Lane 7 — Free A2MCP endpoint

- Implement OpenAPI contract.
- Public HTTPS deployment.
- HTTP 200 JSON response.
- Rate limiting and input validation.
- Health endpoint.
- Curl proof.

**Proof:** external curl succeeds; ambiguous match fails closed; no sensitive data in output.

## Lane 7.5A — Global Nobu rename

- Rename active project identity to Nobu across UI, docs, package metadata, OpenAPI, prompts, env names, and source comments.
- Move immutable historical proof that retains the prior brand to `docs/proof/historical-afterbuy/`.
- Keep A2MCP routes `/health` and `/v1/target-price-check` unchanged.
- Do not change Target policy, matching, monitoring, or HTTP contract behavior.

**Proof:** active repository scan empty of the prior brand (except documented `docs/proof/historical-afterbuy/`); tests, typecheck, and build pass.

## Lane 7.5B — Nobu interface redesign

- Redesign consumer UI under the Nobu brand only.
- Preserve product locks, notices, and fail-closed flows.
- No OKX registration in this lane.

**Proof:** browser path still works; brand and UI updated; tests pass.

## Lane 8 — OKX ASP registration and live listing

- Install/use Onchain OS according to current official instructions.
- Register A2MCP ASP with price `0`.
- Use an accurate listing description.
- Submit for review.
- Address reviewer feedback.
- Record live listing evidence.

**Proof:** approved, live listing. Do not claim completion before this exists.

## Lane 9 — Demo and submission closeout

- 90-second-or-shorter demo.
- Realistic purchase and observed price flow.
- Clearly identify third-party price source and Target final verification.
- X post with `#OKXAI`.
- Official form with ASP and X link.
- Archive submission evidence.

**Proof:** post URL, duration, form confirmation, live ASP.

## Lane 10 — Optional post-listing enhancements

Only if time remains after Lane 8 proof:

- receipt image parsing;
- email alerts;
- paid x402 monitoring/check service;
- more live Target products;
- capacity dashboard.

No second retailer during the hackathon MVP.
