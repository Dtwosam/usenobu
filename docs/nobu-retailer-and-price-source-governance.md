# Retailer and Price-Source Governance

## Purpose

This document prevents Nobu from treating convenient data as authoritative or expanding into unsupported retailers.

## Source classes

- `OFFICIAL_RETAILER_POLICY`: primary source for eligibility, exclusions, and claim route.
- `OFFICIAL_RETAILER_API`: retailer-authorized machine data; none used in MVP.
- `THIRD_PARTY_SEARCH_OBSERVATION`: structured price observed by a provider such as SerpApi.
- `USER_PROVIDED_PURCHASE`: purchase price/date/item information supplied by the user.
- `DERIVED_CALCULATION`: dates and arithmetic produced by deterministic code.
- `UNVERIFIED`: data that cannot support a positive result.

## Current retailer registry

Nobu is designed for retailer-specific connectors. Only one live retailer is active.

| Retailer | Region/channel | Status | Price source | Policy source | Notes |
|---|---|---|---|---|---|
| Target | U.S. Target.com / app purchase | MVP_ACTIVE (first live integration) | SerpApi Google Shopping, seller Target | Official Target help policy | Exclude Target Plus, Alaska/Hawaii, store-only and excluded offers |
| All others | Any | UNSUPPORTED | None | None | Not live; do not imply availability in UI or listing copy |

## Current provider registry

| Provider | Status | Use | Limit / caveat |
|---|---|---|---|
| SerpApi | PROVISIONAL_MVP_APPROVED | Google Shopping observations and price monitoring | Free plan advertised at 250 searches/month; API key required; no U.S. Legal Shield on Free/Starter/Developer; provider does not make Target's final decision |

## Mandatory price provenance

Every price observation must store:

- provider;
- engine;
- query/fingerprint;
- seller/source text;
- product title;
- model/identifier fields available;
- product/result link;
- observed price and currency;
- location, country, language, and device parameters;
- query timestamp;
- raw result hash or bounded raw fixture for audit;
- matching decision and rule version.

## Fail-closed rules

A lower price cannot trigger `POTENTIALLY_ELIGIBLE` unless:

1. the result source/seller is Target;
2. the product fingerprint matches the user-confirmed Target product;
3. the condition is new/standard where available;
4. the offer is not identified as Target Plus;
5. the price is current enough under the data contract;
6. the purchase is still within the policy window;
7. no known policy exclusion applies;
8. currency and supported region match.

If any required condition is missing or ambiguous, return `MATCH_REVIEW_REQUIRED` or `NO_RELIABLE_PRICE`.

## Prohibited methods

- direct Target scraping;
- hidden browser automation against retailer accounts;
- bypassing CAPTCHAs or access controls;
- collecting Target credentials;
- calling third-party data official Target data;
- storing or redistributing a broad retailer catalogue;
- using a screenshot as the final proof Target must accept;
- unsupported competitor matching.
