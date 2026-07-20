# Nobu product overview

**Status:** ACTIVE  
**Aligned:** Lane 8R.2 (2026-07-20)

## 1. What Nobu is

Nobu is an **AI post-purchase monitoring agent** that monitors the **exact product** after purchase and alerts the customer when a **safely matched lower price** may create an opportunity to **request the difference from the retailer**.

## 2. The customer problem

Customers often buy an item shortly before the retailer lowers its price. Requesting the difference usually requires noticing the drop, having proof of purchase, confirming it is the same product, and contacting the retailer while the adjustment window remains open. Most people do not keep checking after checkout.

## 3. Why monitoring matters

Nobu watches the confirmed product during the supported monitoring period and notifies the customer when a lower price is **safely matched**. That gives the customer a timely opportunity to act. Nobu does not guarantee that a lower price will appear or that the retailer will approve an adjustment.

## 4. Website experience

On the UseNobu website, customers can:

- add a purchase;
- review and confirm the exact product;
- see monitoring status and last checks;
- inspect a possible price difference when available;
- use the Action Center to open the retailer’s official contact path and copy price details;
- manage email-alert preference and purchase history when signed in.

## 5. OKX.AI experience

Through compatible AI-agent environments and OKX.AI, customers can:

- describe or structure a purchase;
- confirm the exact product;
- verify an alert email;
- complete free preflight (eligibility, consent, quote);
- activate monitoring with a one-time **$0.99** payment;
- list monitors, check status, enable or disable email alerts, and stop monitoring.

See `docs/nobu-okx-user-guide.md` and the public `/okx` guide.

## 6. End-to-end product flow

1. Provide purchase information (website or conversation).  
2. Discover candidates and **confirm the exact product**.  
3. Verify alert email (agent path) and record monitoring / email consent.  
4. Free preflight checks eligibility and prepares a quote.  
5. Paid path: one-time **$0.99** activation after verified settlement.  
6. Durable scheduled monitoring runs on the locked fingerprint.  
7. Safely matched lower price → possible price difference + consented alert.  
8. Customer uses supporting information and the official retailer contact path.  
9. Customer may stop monitoring or change alert preferences at any time.

## 7. Possible price-difference scenario

| Item | Value |
|---|---|
| Purchase price | $79.99 |
| Later safely matched price | $59.99 |
| **Possible price difference** | **$20.00** |

Nobu **alerts** the customer and presents purchase and observed-price information. The customer **may contact Target** and request the difference. **Target verifies the price, checks eligibility, and makes the final decision.**

Nobu does **not** recover the difference.

## 8. Current retailer support

- **Target is the only retailer currently supported.**
- Eligible Target.com and Target app purchases.
- Target Plus excluded.
- Verified supported geography (U.S., excluding Alaska and Hawaii unless later policy verification changes this).
- Exact-product confirmation required.

## 9. Future retailer direction

Additional retailers are planned. Each must be:

- separately integrated;
- policy-verified;
- data-source-validated;

before Nobu claims support. Do not name future retailers or promise dates.

## 10. Matching and price-source boundaries

- Matching is fail-closed; title-only or ambiguous evidence is not treated as a lower price.
- Prices are **third-party observed** through SerpApi Google Shopping filtered toward Target.
- Observations are **not** official Target API prices.
- All later checks use the locked product fingerprint.

## 11. Privacy and safety

- No Target account login.
- No card, bank, ID-document, wallet-key, password, or 2FA collection.
- No claim submission by Nobu.
- Email used for sign-in and consented alerts is private.

## 12. Current readiness

| Capability | State |
|---|---|
| Website monitoring flow | Live |
| Free `/v1/agent` actions | Live (see OpenAPI) |
| Paid start-monitoring route | Implemented and deployed; ASP paid-service registration is Lane 8R |
| Official OKX seller verify/settle | Integrated (Lane 8R.0); requires production credentials |
| Durable scheduler + email alerts | Implemented |
| ASP #5541 free listing | Exists; do not edit until Lane 8R |
| Genuine end-to-end paid marketplace proof | Lane 7.4G |
