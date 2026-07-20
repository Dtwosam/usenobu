# Nobu Clean Master Spec

**Version:** 1.0  
**Status:** ACTIVE INTERNAL SOURCE OF TRUTH  
**Date:** 2026-07-13

## 1. Product definition

Nobu is an **AI post-purchase monitoring agent** that monitors the **exact product** after purchase and alerts the customer when a **safely matched lower price** may create an opportunity to **request the difference from the retailer**.

Customers use Nobu through the **UseNobu website** and through **OKX.AI** in compatible AI-agent environments. Nobu is also offered as an OKX.AI A2MCP agent service with free preparation actions and a paid `$0.99` monitoring activation path.

**Target is the only retailer currently supported** (eligible Target.com and Target app purchases). More retailers are planned; each must be separately integrated and verified before support is claimed.

Natural-language intake may extract purchase fields, but **only user-confirmed structured data** enters deterministic matching, policy, and monitoring.

A customer adds a supported purchase once, confirms the exact product, and Nobu monitors third-party observed Target prices during the applicable window. When a lower price is safely matched, Nobu presents a **possible price difference** and the retailer’s official contact path.

For Target purchases, **Target verifies the price and makes the final decision**. Nobu does not contact the retailer, submit a request, or guarantee an adjustment.

## 2. Core user promise

> Confirm the exact product once. Nobu monitors during the supported window and alerts you when a safely matched lower price may create an opportunity to request the difference. The retailer verifies and decides.

## 3. Problem

Customers may buy an item shortly before Target lowers its price. Target may allow a qualifying adjustment within 14 days, but the customer must notice the drop, preserve the receipt, identify the exact item, and request the match while the price remains valid. Most customers do not keep checking after checkout.

## 4. Target user

Initial user:

- U.S. consumer with a recent Target.com or Target app purchase;
- purchase made within the last 14 days;
- item sold by Target, not Target Plus;
- item has a stable model, item identifier, or exact Target URL;
- user wants monitoring without repeatedly checking the product page.

## 5. Marketplace position (product)

- ASP type: A2MCP
- Free endpoint: public HTTPS preparation and monitor-management actions
- Paid path: `$0.99` monitoring activation (x402) under the same ASP identity when registered
- Listing must match implemented behavior only

## 6. MVP scope

### Included

- natural-language purchase intake with AI extraction and confirmation gate;
- manual structured purchase entry (always available);
- Target product URL and identifier intake;
- optional receipt text/image parsing;
- bounded free `POST /v1/agent` actions (understand, discover, confirm, email verify, preflight, monitor manage, status);
- paid `POST /v1/agent/start-monitoring` for one-purchase `$0.99` activation;
- candidate product discovery through SerpApi Google Shopping;
- user confirmation of the exact Target offer once;
- locked product fingerprint;
- scheduled price checks during the remaining 14-day window;
- fail-closed product and seller matching;
- price history for the monitored purchase;
- price-drop detection;
- Action Center that guides the user through Target’s official request process (Nobu never submits the request);
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

1. User describes a purchase in natural language **or** enters structured fields manually.
2. If NL: Nobu extracts candidate fields; user reviews, corrects, and confirms structured details. AI does not match or monitor.
3. User selects **Find my product** with confirmed structured fields. A valid Target URL and TCIN are required, plus at least one additional strong identifier such as model or UPC/GTIN, unless deterministic discovery already provides equivalent verified identity evidence. (Purchase price and date are also required.)
4. Nobu queries SerpApi (or demo fixtures) for Target offers matching the product.
5. Nobu returns one or more candidates with seller, product identifiers, URL, and observed price.
6. The user confirms the exact product once.
7. Nobu stores the product fingerprint and starts checks until the 14-day window ends.
8. Each scheduled check searches for the locked Target offer.
9. If a lower valid observed price appears, Nobu creates an alert.
10. The result shows potential recovery, days remaining, price provenance, and Target's official claim route.
11. The user contacts Target. Target independently verifies the price and decides the adjustment.

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
- "Nobu will recover your money"

## 10. Success criteria

The Target MVP is complete only when:

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
