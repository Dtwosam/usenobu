# AfterBuy Clean Master Spec

**Version:** 1.0  
**Status:** ACTIVE INTERNAL SOURCE OF TRUTH  
**Date:** 2026-07-13

## 1. Product definition

AfterBuy is a consumer post-purchase price-protection service and OKX.AI A2MCP ASP.

A user adds a recent eligible Target.com purchase once. AfterBuy identifies and locks the exact Target product, checks a third-party shopping data source for a lower Target online price while the purchase remains within Target's adjustment window, and alerts the user when a possible price-adjustment opportunity appears.

AfterBuy returns the observed price difference, remaining time, evidence provenance, policy conditions, and Target's official next step. Target verifies the price and makes the final decision.

## 2. Core user promise

> Add a recent Target purchase once. AfterBuy watches the online price during the eligible window and alerts you when you may be able to request the difference.

## 3. Problem

Customers may buy an item shortly before Target lowers its price. Target may allow a qualifying adjustment within 14 days, but the customer must notice the drop, preserve the receipt, identify the exact item, and request the match while the price remains valid. Most customers do not keep checking after checkout.

## 4. Target user

Initial user:

- U.S. consumer with a recent Target.com or Target app purchase;
- purchase made within the last 14 days;
- item sold by Target, not Target Plus;
- item has a stable model, item identifier, or exact Target URL;
- user wants monitoring without repeatedly checking the product page.

## 5. Hackathon position

- ASP type: A2MCP
- Primary category: Lifestyle Companion
- Secondary category: Software Utility
- General award strategy: Best Product through clarity, completeness, and real user value
- Initial endpoint: free HTTP 200 endpoint
- Paid x402: optional after listing and proof, not a launch blocker

## 6. MVP scope

### Included

- manual purchase entry;
- Target product URL and identifier intake;
- optional receipt text/image parsing;
- candidate product discovery through SerpApi Google Shopping;
- user confirmation of the exact Target offer once;
- locked product fingerprint;
- scheduled price checks during the remaining 14-day window;
- fail-closed product and seller matching;
- price history for the monitored purchase;
- price-drop detection;
- potential recovery calculation;
- Target policy-window calculation;
- in-app alert and optional email alert;
- current eligibility/check result;
- official Target claim instructions;
- free A2MCP one-time check endpoint;
- public HTTPS deployment and OKX.AI listing.

### Excluded

- Target store purchases;
- Target Plus items;
- Alaska and Hawaii;
- competitor price matching;
- clearance, closeout, liquidation, damaged, used, open-package, refurbished, pre-owned, rental, bundled, financing, rebate, gift-card, coupon, clinic, pharmacy, optical, mobile-contract, service, alcohol, preorder, or other excluded items;
- claim submission;
- retailer login;
- inbox access;
- payment-card, bank, ID-document, private-key, password, or 2FA collection;
- direct scraping of Target;
- other retailers;
- return-and-rebuy calculations;
- warranty, delivery, subscription, or chargeback recovery;
- guaranteed refunds;
- production-scale monitoring beyond provider capacity.

## 7. User journey

1. User enters a Target.com purchase URL, purchase price, purchase date, and optional model/TCIN/UPC.
2. AfterBuy queries SerpApi for Target offers matching the product.
3. AfterBuy returns one or more candidates with seller, product identifiers, URL, and observed price.
4. The user confirms the exact product once.
5. AfterBuy stores the product fingerprint and starts checks until the 14-day window ends.
6. Each scheduled check searches for the locked Target offer.
7. If a lower valid observed price appears, AfterBuy creates an alert.
8. The result shows potential recovery, days remaining, price provenance, and Target's official claim route.
9. The user contacts Target. Target independently verifies the price and decides the adjustment.

## 8. Locked result statuses

- `MONITORING_ACTIVE`
- `PRICE_DROP_DETECTED`
- `POTENTIALLY_ELIGIBLE`
- `NO_PRICE_DROP`
- `WINDOW_EXPIRED`
- `MATCH_REVIEW_REQUIRED`
- `NO_RELIABLE_PRICE`
- `POLICY_EXCLUSION`
- `UNSUPPORTED_PURCHASE`
- `POLICY_STALE`
- `DATA_SOURCE_UNAVAILABLE`

## 9. Locked language

Allowed:

- "Observed Target price"
- "Potential recovery"
- "Price drop detected"
- "You may be able to request the difference"
- "Target must verify the lower price"
- "Target makes the final decision"

Forbidden:

- "Official Target API price"
- "Guaranteed refund"
- "Target owes you"
- "Refund confirmed"
- "AfterBuy will recover your money"

## 10. Success criteria

The hackathon MVP is complete only when:

- a user can register a supported Target.com purchase;
- the exact Target product is confirmed and fingerprinted;
- a scheduled or explicitly triggered check obtains a live SerpApi result;
- the system rejects ambiguous/non-Target/mismatched results;
- a lower observed Target price produces a correct potential recovery and deadline;
- the A2MCP endpoint returns a documented HTTP 200 response;
- the service is deployed over HTTPS;
- the ASP is approved and live on OKX.AI;
- the X demo is no longer than 90 seconds;
- the official submission form is completed before the deadline.
