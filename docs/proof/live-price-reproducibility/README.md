# Live Price Reproducibility Audit

**Date:** 2026-07-14  
**Verdict:** `NOBU_LIVE_PRICE_REPRO_BLOCKED`  
**Canonical route:** `POST https://usenobu.vercel.app/v1/target-price-check`

## Findings

The earlier `$29.99` AirTag acceptance was produced by the now-removed temporary `GET /v1/capability-audit` diagnostic route. That route constructed a synthetic locked fingerprint with `product_title: "Apple AirTag"` and `brand: "Apple"`, generated `Apple AirTag 54191097 Target`, and evaluated with `offerMatchesLockedFingerprint`.

The canonical A2MCP route instead generated `AirTag 54191097 194252096261 Target` and called `evaluateProductMatches` with the title derived from the URL. The original commit's own canonical production probe recorded `MATCH_REVIEW_REQUIRED` for AirTag, and the bounded current canonical request did the same.

Therefore the former proof was live SerpApi data but was not proof of a reproducible canonical A2MCP acceptance. No fixture mode, identity injection into the canonical route, or cached-result claim is evidenced by the artifacts.

## Current canonical observation

Request: Target AirTag TCIN `54191097`, model `AirTag`, UPC `194252096261`, Target URL, USD purchase price `$35`, purchase date `2026-07-14`, U.S./TX/Target online.

Response: HTTP `200`, `MATCH_REVIEW_REQUIRED`, no accepted price. The public canonical response deliberately does not expose candidate payloads, so no candidate-level trace exists without adding and deploying an audited diagnostic mechanism. No further provider calls were made after this failure.

## Repair

Removed the temporary `/v1/capability-audit` route so it cannot report a separate diagnostic success while canonical A2MCP fails. Corrected the current-state capability claim. Matching rules, A2MCP schema, `/v1/agent`, and provider behavior are unchanged.
