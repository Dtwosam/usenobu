# Target U.S. Price-Match Policy Contract — MVP

**Policy ID:** `target-us-online-price-match-v1`  
**Status:** ACTIVE, FRESHNESS-SENSITIVE  
**Last verified:** 2026-07-13

## Supported case

- Purchase made through Target.com or the Target app.
- Item sold by Target, not Target Plus.
- User is in a supported U.S. location; Alaska and Hawaii excluded from the current MVP.
- Request is within 14 days after purchase.
- Lower observed price is for the identical Target item.
- Target can still verify the valid lower price.

## Exact-match dimensions

Where applicable, identical means:

- item;
- brand;
- size;
- weight;
- color;
- quantity;
- model number.

## Proof and claim route

- Original receipt, digital receipt, or packing slip is required.
- For Target.com/app purchases, the user contacts Target online chat or Guest Services phone.
- Target team members verify the lower price.
- Screenshots or pictures are not accepted as the final proof by Target.
- Nobu's observation is an alert and decision aid, not Target's verification.

## MVP exclusions

Exclude or fail closed for:

- Target Plus;
- Alaska and Hawaii;
- in-store-only price from another Target store;
- clearance, closeout, liquidation;
- damaged, used, open package, refurbished, pre-owned;
- rent/lease-to-own;
- minimum-purchase and total-store/site discounts;
- non-branded items where exact identity is unreliable;
- typographical errors;
- credit-card, financing, gift-card, bundle, service, free-item, rebate, mail-in, tax offers;
- contract mobile devices/plans;
- optical, clinic, pharmacy, warranties, assembly or other product services;
- preorders;
- alcohol unless a later jurisdiction-specific contract is approved;
- coupons or bonuses that cannot be combined;
- any condition the data source cannot identify confidently.

## Deterministic policy logic

1. If purchase channel is not Target online, return `UNSUPPORTED_PURCHASE`.
2. If jurisdiction is Alaska or Hawaii, return `UNSUPPORTED_PURCHASE`.
3. If Target Plus or another excluded type is known, return `POLICY_EXCLUSION`.
4. Compute `days_since_purchase` from the user-confirmed purchase date.
5. If `days_since_purchase > 14`, return `WINDOW_EXPIRED`.
6. If no locked exact match exists, return `MATCH_REVIEW_REQUIRED`.
7. If no reliable current Target price exists, return `NO_RELIABLE_PRICE`.
8. If current price is not lower than purchase price, return `NO_PRICE_DROP`.
9. If all supported deterministic checks pass, return `PRICE_DROP_DETECTED` plus `POTENTIALLY_ELIGIBLE` language.
10. Always state that Target verifies the lower price and makes the final decision.

## Freshness rule

Recheck the official Target policy before:

- initial production deployment;
- OKX listing submission;
- final hackathon form submission;
- any policy change in code;
- any future retailer expansion.

If the policy has not been rechecked within 24 hours during the hackathon submission period, the production response may continue only with the last verified policy timestamp and a visible warning; code changes affecting eligibility must stop until reverified.
