# SerpApi Google Shopping Data Contract

**Provider:** SerpApi  
**Engine:** `google_shopping`  
**Status:** PROVISIONAL MVP SOURCE  
**Last verified:** 2026-07-13

## What SerpApi supplies

SerpApi exposes structured Google Shopping search results through an API endpoint. It is used to observe possible Target offers and prices. It is not an official Target API and does not decide Target eligibility.

## Account and capacity

- A normal SerpApi account and API key are required.
- The public pricing page currently advertises 250 searches per month on the Free plan.
- The Free plan is sufficient only for a bounded hackathon proof and small monitored set.
- Search capacity must be budgeted and measured.
- Cached search behavior and exact request counting must be tested rather than assumed.

## Legal/terms caution

SerpApi's legal page says its U.S. Legal Shield is not included with Free, Starter, or Developer plans. SerpApi covers collection liability only on qualifying recurring plans and does not assume responsibility for how customers use the data.

Therefore:

- treat free-plan use as a bounded prototype decision;
- do not claim legal indemnification;
- do not redistribute raw datasets;
- do not use results for unlawful, deceptive, or abusive purposes;
- review the current SerpApi legal page before public launch or scale.

## Required query controls

For consistent Target monitoring, record and reuse:

- `engine=google_shopping`;
- `gl=us`;
- `hl=en`;
- a stable U.S. location parameter selected for the monitored user/product;
- exact model/identifier terms plus Target in the query;
- default cache behavior unless freshness proof requires `no_cache=true` and capacity permits;
- desktop device unless a test proves another mode is needed.

## Enrollment and product lock

1. Query candidates using the Target URL/title/model/identifier.
2. Filter candidates to source/seller Target.
3. Present candidate details to the user.
4. User confirms the exact product once.
5. Store a locked fingerprint using all stable fields available.
6. Later monitoring only accepts results that satisfy the locked fingerprint rules.

## Matching hierarchy

Strongest to weakest:

1. Exact Target product URL / TCIN or stable retailer identifier match.
2. Exact manufacturer model plus Target seller and compatible variant attributes.
3. Exact UPC/GTIN plus Target seller.
4. Title-only similarity is never sufficient for an automatic positive result.

## Freshness and reliability

A price observation must include `observed_at`. A result older than the configured maximum age cannot trigger an alert. Provider errors, missing Target offers, conflicting prices, or changed product links return a non-positive status and must not be silently converted into a match.

## Required provider statuses

- `LIVE_TARGET_MATCH`
- `TARGET_CANDIDATE_REVIEW`
- `NO_TARGET_RESULT`
- `AMBIGUOUS_TARGET_RESULTS`
- `PROVIDER_RATE_LIMITED`
- `PROVIDER_ERROR`
- `STALE_RESULT`

## Secret handling

The API key must remain server-side in an environment variable. Never include it in browser bundles, logs, fixtures, screenshots, demo videos, or repository files.
