# AfterBuy ChatGPT Project Source

**Generated:** 2026-07-13

This combined source mirrors the modular governing files. When the repository exists, the modular files remain authoritative for implementation.


---

## FILE: `START-HERE.md`

# AfterBuy Source-of-Truth Pack v1

**Prepared:** 2026-07-13  
**Project:** AfterBuy  
**Hackathon:** OKX.AI Genesis Hackathon  
**Current product decision:** Target.com price-drop monitoring through SerpApi, with a free A2MCP check endpoint and a small consumer web app.

## What AfterBuy is

AfterBuy lets a user add a recent eligible Target.com purchase once. It checks a third-party shopping data source for a lower Target online price during Target's 14-day adjustment window and alerts the user when they may be able to request the difference.

AfterBuy does **not** guarantee a refund, submit a claim, log into Target, or claim its observed price is an official Target API price. Target verifies the price and makes the final decision.

## Mandatory source stack

Read these in order before planning or changing code:

1. `AGENTS.md`
2. `docs/afterbuy-clean-master-spec.md`
3. `docs/afterbuy-current-state.md`
4. `docs/afterbuy-hackathon-compliance-matrix.md`
5. `docs/afterbuy-retailer-and-price-source-governance.md`
6. `docs/afterbuy-target-policy-contract.md`
7. `docs/afterbuy-serpapi-data-contract.md`
8. `docs/afterbuy-architecture.md`
9. `openapi/afterbuy-a2mcp.openapi.yaml`
10. `docs/afterbuy-build-order.md`
11. `docs/afterbuy-test-and-proof-plan.md`
12. `docs/afterbuy-privacy-security-threat-model.md`
13. `docs/afterbuy-submission-runbook.md`
14. `docs/external-source-registry.md`

## Source precedence

When sources conflict, use this order:

1. Current official external rules, policies, terms, and API documentation
2. `docs/afterbuy-clean-master-spec.md`
3. `docs/afterbuy-current-state.md`
4. Compliance and governance documents
5. Policy/data contracts and OpenAPI contract
6. Active build order
7. Tests and proof plan
8. README, prompts, demo copy, and comments

Dynamic external facts must be rechecked against the official URL before they are changed in the repository.

## Important current caveats

- Target allows qualifying price-adjustment requests within 14 days, but Target makes the final decision.
- Target requires an identical item and valid current price; screenshots are not accepted as proof at the store.
- The MVP supports Target.com purchases in supported U.S. locations and excludes Target Plus, Alaska, and Hawaii.
- SerpApi is a third-party observation source. The free plan currently advertises 250 searches per month.
- SerpApi's U.S. Legal Shield is not included with the Free, Starter, or Developer plans.
- No price result is accepted unless the Target seller and exact product match pass the fail-closed matching contract.
- Marketplace/wallet/payment actions must follow OKX eligibility rules. Never bypass age, identity, location, or guardian requirements.

## Tool responsibilities

- **ChatGPT:** product, architecture, lane coordination, source-of-truth management, and review. Upload `AFTERBUY_CHATGPT_PROJECT_SOURCE.md` and paste `CHATGPT_PROJECT_INSTRUCTIONS.md` into Project instructions. Modular files may also be uploaded as sources.
- **Grok Build:** primary repository implementation and test execution, lane by lane. Follow `AGENTS.md` and `prompts/GROK_BUILD_LANE_PROMPT_TEMPLATE.md`.
- **Regular Grok research:** current public discussion, competition, and external-change research only, using `prompts/GROK_RESEARCH_VERIFICATION_PROMPT.md`. Regular Grok research does not implement product code and does not override official sources.
- **Official Target, OKX, and SerpApi sources** remain authoritative for external facts. Dynamic external facts must be rechecked against the official URL before repository changes.
- **Claude/Codex (optional fallback only):** not the active AfterBuy implementation workflow. If needed, use `prompts/CLAUDE_CODEX_LANE_PROMPT_TEMPLATE.md` under the same hard locks.


---

## FILE: `AGENTS.md`

# AGENTS.md — AfterBuy

## Mandatory reading order

Before planning, auditing, implementing, testing, documenting, or closing a lane, read:

1. `docs/afterbuy-clean-master-spec.md`
2. `docs/afterbuy-current-state.md`
3. `docs/afterbuy-hackathon-compliance-matrix.md`
4. `docs/afterbuy-retailer-and-price-source-governance.md`
5. `docs/afterbuy-target-policy-contract.md`
6. `docs/afterbuy-serpapi-data-contract.md`
7. `docs/afterbuy-architecture.md`
8. `openapi/afterbuy-a2mcp.openapi.yaml`
9. `docs/afterbuy-build-order.md`
10. `docs/afterbuy-test-and-proof-plan.md`
11. `docs/afterbuy-privacy-security-threat-model.md`
12. `docs/afterbuy-submission-runbook.md`
13. `docs/external-source-registry.md`

The active build order is `docs/afterbuy-build-order.md`.

## Execution discipline

- Start each lane with a todo/checklist and keep it updated.
- Inspect the repository and current state before editing.
- Work only on the active lane. Do not skip lanes or silently expand scope.
- Run the smallest relevant tests first. Stop on the first failure, diagnose it, and repair before widening test scope.
- Do not run destructive commands or touch production data without explicit instruction.
- Keep secrets in environment variables and never commit them.
- Commit only lane-specific files when asked. Do not tag unless explicitly asked.
- Final report must include changed files, tests and outputs, proof, remaining blockers, and the exact next lane.

## Hard product locks

- MVP retailer: Target only.
- MVP purchase channel: Target.com / Target online purchase only.
- Supported geography: U.S. excluding Alaska and Hawaii unless the official policy is later verified to permit it.
- Target Plus is excluded from the MVP.
- Price source: SerpApi Google Shopping result filtered and matched to Target.
- SerpApi is third-party observed data, not an official Target API.
- The user confirms the exact matched product once before monitoring begins.
- All later checks must use the locked product fingerprint.
- Exact matching is fail closed. Ambiguous matches return `MATCH_REVIEW_REQUIRED` or `NO_RELIABLE_PRICE`.
- Target makes the final adjustment decision.
- Never guarantee a refund.
- No direct Target scraping.
- No retailer account login.
- No claim submission.
- No card, banking, ID-document, wallet-key, password, or 2FA collection.
- No fake live data, refunds, orders, users, reviews, or hackathon approvals.
- Free A2MCP endpoint first. x402 is optional only after the free service is stable and listed.
- Do not add another retailer before the Target MVP closeout.

## AI boundary

AI may:

- parse receipt/order text;
- extract candidate product identifiers;
- explain results in plain English;
- draft a user-facing reminder or claim checklist.

AI may not:

- invent Target rules;
- override deterministic matching or eligibility;
- convert ambiguous evidence into a confirmed match;
- guarantee a price adjustment;
- rewrite price/source provenance.


---

## FILE: `docs/afterbuy-clean-master-spec.md`

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


---

## FILE: `docs/afterbuy-current-state.md`

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


---

## FILE: `docs/afterbuy-hackathon-compliance-matrix.md`

# AfterBuy Hackathon Compliance Matrix

**Official event:** OKX.AI Genesis Hackathon  
**Submission deadline:** 2026-07-17 23:59 UTC

| Requirement / criterion | Official basis | AfterBuy implementation | Required proof | Status |
|---|---|---|---|---|
| Clear real-world use case | Build an ASP solving a clear real-world use case | Monitor recent Target purchases for possible price drops | Working end-to-end demo | Pending |
| Crypto not required | Both crypto and non-crypto services welcome | Consumer shopping service | Listing description | Satisfied by design |
| Functional ASP | ASP must be submitted for listing | Public free A2MCP endpoint | HTTPS URL + curl HTTP 200 | Pending |
| Approved and live | Non-live/unapproved listing is invalid | Register and list on OKX.AI | Live marketplace record | Pending |
| X participation post | Must post using `#OKXAI` | Product story and demo | X post URL | Pending |
| Demo ≤ 90 seconds | Clear demo/walkthrough, no longer than 90 seconds | Target purchase → tracking → drop → result | Final video duration | Pending |
| Official form | Form with ASP details and X link | Submission runbook | Confirmation evidence | Pending |
| Best Product | Product experience, completeness, user value | Simple consumer flow, honest provenance, complete result | Judge-ready test path | Pending |
| Lifestyle Companion | Top Lifestyle ASP | Main category | Category selection/listing | Pending |
| Software Utility | Top Software Services ASP | Secondary fit | Category selection if permitted | Pending |
| Revenue Rocket | Qualified revenue, orders, reviews | Not a launch blocker; free endpoint first | Only real orders/reviews count | Optional |
| Social Buzz | Social traction/community reach | Clear money-saved demo | Real X metrics | Optional |

## Official timing conflict handling

The official event page displays a header start time of July 2, 2026 12:00 UTC, while its FAQ says submissions are open from July 3, 2026 00:00 UTC. The deadline is consistently July 17, 2026 23:59 UTC and controls the build.

The ASP documentation describes review as one business day; the registration quickstart says within 24 hours. Operationally, submit as early as possible and do not depend on same-day approval.

## Eligibility and account rule

Do not bypass any OKX, Agentic Wallet, payment, identity, location, age, or guardian requirement. Where an eligible adult or guardian is required, that person must participate in the relevant account and agreement steps.


---

## FILE: `docs/afterbuy-retailer-and-price-source-governance.md`

# Retailer and Price-Source Governance

## Purpose

This document prevents AfterBuy from treating convenient data as authoritative or expanding into unsupported retailers.

## Source classes

- `OFFICIAL_RETAILER_POLICY`: primary source for eligibility, exclusions, and claim route.
- `OFFICIAL_RETAILER_API`: retailer-authorized machine data; none used in MVP.
- `THIRD_PARTY_SEARCH_OBSERVATION`: structured price observed by a provider such as SerpApi.
- `USER_PROVIDED_PURCHASE`: purchase price/date/item information supplied by the user.
- `DERIVED_CALCULATION`: dates and arithmetic produced by deterministic code.
- `UNVERIFIED`: data that cannot support a positive result.

## Current retailer registry

| Retailer | Region/channel | Status | Price source | Policy source | Notes |
|---|---|---|---|---|---|
| Target | U.S. Target.com / app purchase | MVP_ACTIVE | SerpApi Google Shopping, seller Target | Official Target help policy | Exclude Target Plus, Alaska/Hawaii, store-only and excluded offers |
| All others | Any | UNSUPPORTED | None | None | Do not implement before Target MVP closeout |

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


---

## FILE: `docs/afterbuy-target-policy-contract.md`

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
- AfterBuy's observation is an alert and decision aid, not Target's verification.

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


---

## FILE: `docs/afterbuy-serpapi-data-contract.md`

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


---

## FILE: `docs/afterbuy-architecture.md`

# AfterBuy MVP Architecture

## Reference stack

The default implementation is:

- TypeScript;
- Next.js full-stack application or equivalent server-capable framework;
- PostgreSQL for deployed persistence;
- a provider scheduler/cron for bounded monitoring;
- server-side SerpApi client;
- optional email provider for alerts;
- public HTTPS deployment;
- free A2MCP-compatible JSON endpoint.

A different stack requires an ADR and must not weaken the contracts.

## Components

### 1. Web UI

- add purchase form;
- candidate product confirmation;
- monitoring status;
- price history;
- price-drop alert;
- Target claim instructions;
- privacy and supported-case notices.

### 2. Purchase service

Stores:

- user/account reference;
- Target product URL;
- user-confirmed purchase price/date;
- purchase channel and jurisdiction;
- product fingerprint;
- monitoring deadline;
- status.

### 3. SerpApi connector

- creates normalized queries;
- fetches Google Shopping results;
- normalizes seller, identifiers, link, price, currency, location, timestamp;
- returns provider status without deciding policy eligibility.

### 4. Product matching engine

- candidate discovery;
- seller filter;
- exact identifier/model/variant comparison;
- user confirmation;
- locked fingerprint;
- fail-closed monitoring match.

### 5. Target policy engine

- 14-day calculation;
- supported channel/geography;
- known exclusions;
- current policy version;
- deterministic result status.

### 6. Monitoring scheduler

- selects active purchases inside the window;
- respects SerpApi capacity;
- checks each locked product;
- stores price observations;
- creates an alert only on a valid lower match;
- stops at expiry or unsupported state.

### 7. Notification service

MVP requires in-app alerts. Email is optional. Alerts must include provenance and never say refund guaranteed.

### 8. A2MCP API

The initial marketplace service performs a one-time Target purchase check and returns structured evidence. Persistent monitoring is available through the web product and may later become a paid ASP service.

## Core tables

- `users`
- `purchases`
- `product_matches`
- `price_observations`
- `monitor_runs`
- `alerts`
- `policy_versions`
- `api_call_audit`

## Scheduler capacity rule

The scheduler must calculate the remaining monthly search budget before selecting work. It must not overspend silently. Use a deterministic queue and record skipped checks with a reason.

## Observability

Record:

- provider latency/status;
- searches consumed;
- candidates returned;
- matching result;
- price observation;
- policy result;
- alert created or suppressed;
- endpoint status.

Do not log receipt images, full addresses, emails, keys, or sensitive personal data.


---

## FILE: `docs/afterbuy-build-order.md`

# AfterBuy Active Build Order

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


---

## FILE: `docs/afterbuy-test-and-proof-plan.md`

# AfterBuy Test and Proof Plan

## Principles

- Tests prove listing claims.
- Live data proof is bounded and redacted.
- Fixture proof must never be described as live.
- Matching and policy logic fail closed.
- Stop on first failure in lane execution.

## 1. Target policy fixtures

Required cases:

- online Target-sold purchase, day 0;
- day 14 boundary;
- day 15 expired;
- future purchase date;
- Alaska;
- Hawaii;
- in-store purchase;
- Target Plus;
- known clearance/excluded flag;
- coupon/bonus ambiguity;
- preorder;
- missing receipt/purchase date;
- policy stale.

## 2. Matching fixtures

- exact Target URL/identifier;
- exact model and Target seller;
- wrong model suffix;
- wrong size/color/quantity;
- non-Target seller;
- Target Plus source;
- multiple Target candidates;
- title-only similarity;
- missing identifiers;
- changed product link;
- currency mismatch.

## 3. SerpApi connector tests

- success normalization;
- no Target result;
- malformed price;
- multiple sellers;
- rate limit;
- timeout;
- provider error;
- stale/cached observation metadata;
- key is not logged;
- bounded live query audit.

## 4. Monitoring tests

- active purchase selected;
- expired purchase skipped;
- capacity guard skips safely;
- first lower price creates one alert;
- repeated same price is idempotent;
- price rises after drop;
- provider outage does not create false alert;
- ambiguous result suppresses alert;
- policy version attached to result.

## 5. A2MCP API tests

- valid request → HTTP 200;
- invalid request → documented 4xx;
- unsupported purchase → structured non-positive status;
- ambiguous match → no positive eligibility;
- provider unavailable → structured degraded response;
- health endpoint;
- rate limiting;
- no secret or personal data leakage.

## 6. Security/privacy tests

- prompt injection in receipt/title remains data;
- API key never reaches client;
- full card number rejected/redacted;
- password/2FA/private-key fields rejected;
- logging redaction;
- authorization on purchase records;
- webhook/cron endpoint protection;
- duplicate/replay resistance.

## 7. Submission proof bundle

Archive:

- exact source commit;
- deployment URL;
- API curl request/response;
- current official source verification dates;
- live SerpApi capability audit with key removed;
- demo product identifier;
- demo recording and duration;
- ASP listing URL/status;
- X post URL;
- form confirmation;
- known limitations.


---

## FILE: `docs/afterbuy-privacy-security-threat-model.md`

# AfterBuy Privacy and Security Threat Model

## Sensitive data risks

Purchases may contain names, emails, addresses, order numbers, product history, and partial payment information. The MVP should prefer manual structured entry and collect only what is necessary.

## Data minimization

Required fields:

- Target product URL/identifier;
- purchase price;
- purchase date;
- supported location/channel;
- optional alert destination.

Do not require:

- Target password;
- payment-card number;
- bank details;
- government ID;
- wallet private key or seed phrase;
- 2FA code;
- full home address.

## Upload handling

If receipt images are added:

- process ephemerally;
- redact unnecessary personal fields;
- do not store raw images by default;
- never log OCR text wholesale;
- reject documents containing full card or identity data;
- allow the user to review extracted fields before saving.

## Primary threats

- SerpApi key exposure;
- insecure cron/monitor endpoint;
- cross-user purchase access;
- prompt injection from product titles or receipt text;
- false product match causing misleading alerts;
- provider response tampering or stale data;
- abusive high-volume queries exhausting the free quota;
- forged purchase data;
- deceptive guaranteed-refund language;
- unauthorized claim submission.

## Controls

- server-only secrets;
- authentication and per-user authorization;
- signed/internal scheduler calls;
- rate limiting;
- schema validation;
- deterministic matching and policy engine;
- raw external text treated as untrusted data;
- output escaping;
- provenance and timestamps;
- fail-closed statuses;
- audit logs without sensitive content;
- no claim automation;
- clear disclaimer that Target verifies and decides.

## Platform eligibility

Never provide instructions to bypass OKX, retailer, payment, identity, age, region, or guardian restrictions. Account and agreement steps must be performed by an eligible person under the applicable terms.


---

## FILE: `docs/afterbuy-submission-runbook.md`

# AfterBuy Submission Runbook

## Listing identity

**Name:** AfterBuy  
**Type:** A2MCP  
**Initial price:** 0  
**Primary category:** Lifestyle Companion  
**Secondary positioning:** Software Utility

## Accurate listing description

> AfterBuy checks a recent eligible Target.com purchase against a third-party observed Target online price and Target's current price-match rules. It returns a possible price drop, estimated difference, remaining request window, evidence provenance, and Target's official next step. Target verifies the lower price and makes the final decision.

Do not claim:

- official Target API integration;
- all Target products or locations;
- automatic refunds;
- guaranteed eligibility;
- other retailers;
- claim submission.

## Endpoint preflight

- public HTTPS;
- free endpoint returns HTTP 200;
- valid JSON;
- documented input/output;
- health check passes;
- rate limits active;
- provider errors handled;
- no secrets in response or logs.

## Current official registration workflow

1. Install Onchain OS and log in to Agentic Wallet using the current official guide.
2. Register as an A2MCP ASP.
3. Provide service name, description, price `0`, and endpoint.
4. Ask Onchain OS to list the ASP.
5. Monitor the registered email/Agent notification for review result.
6. Fix and resubmit if rejected.
7. Do not call the hackathon submission valid until the ASP is live.

Do not bypass any platform account or eligibility requirement.

## X post checklist

- `#OKXAI` included;
- AfterBuy introduced in one sentence;
- real user problem explained;
- demo/walkthrough no longer than 90 seconds;
- price source honestly labelled;
- no guaranteed refund claim;
- live ASP route shown;
- supported case and limitation clear.

## Demo story

1. User adds a recent Target.com purchase.
2. AfterBuy identifies a Target offer and the user confirms the exact product.
3. Monitoring runs.
4. A lower observed Target price appears.
5. AfterBuy shows potential recovery and days remaining.
6. AfterBuy shows Target's official contact route and explains Target verifies the price.

If a natural live price drop is unavailable, use a clearly labelled recorded historical observation or test fixture for the transition while still showing a real live provider lookup. Never present a fixture as a real current refund opportunity.

## Final form checklist

- ASP details;
- live listing proof;
- X post link;
- submitted before 2026-07-17 23:59 UTC;
- confirmation archived.


---

## FILE: `docs/external-source-registry.md`

# External Source Registry

**Rule:** Official sources govern policy and hackathon facts. SerpApi official documentation governs its API, pricing, and terms. Public discussion can inform product positioning but cannot override these sources.

| ID | Source | Publisher | URL | Relevant decision | Last checked | Status |
|---|---|---|---|---|---|---|
| OKX-HACKATHON | OKX.AI Genesis Hackathon | OKX | https://web3.okx.com/xlayer/build-x-series | Deadline, eligibility, categories, demo, listing requirement, judging | 2026-07-13 | CURRENT |
| OKX-A2MCP | A2MCP Guide | OKX | https://web3.okx.com/onchainos/dev-docs/okxai/howtomcp | Free HTTP 200 or x402, public HTTPS, X Layer payment configuration | 2026-07-13 | CURRENT |
| OKX-ASP | ASP Introduction | OKX | https://web3.okx.com/onchainos/dev-docs/okxai/asp-introduction | A2MCP suitability and review/listing flow | 2026-07-13 | CURRENT |
| OKX-REGISTER | ASP Registration | OKX | https://web3.okx.com/onchainos/dev-docs/okxai/registerasp | Registration prompts/fields and 24-hour wording | 2026-07-13 | CURRENT |
| TARGET-POLICY | Price Match Guarantee | Target | https://www.target.com/help/articles/policies-guidelines/price-match-guarantee | 14-day window, identical item, proof, exclusions, Alaska/Hawaii, Target Plus | 2026-07-13 | CURRENT |
| TARGET-SUMMARY | Target price-match summary | Target | https://www.target.com/help/article/000062256 | Contact routes and summary | 2026-07-13 | CURRENT |
| SERPAPI-PRICING | Plans and Pricing | SerpApi | https://serpapi.com/pricing | Free plan 250 searches/month | 2026-07-13 | CURRENT |
| SERPAPI-SHOPPING | Google Shopping API | SerpApi | https://serpapi.com/google-shopping-api | Engine, endpoint, parameters, structured shopping results | 2026-07-13 | CURRENT |
| SERPAPI-LEGAL | Legal Documents | SerpApi | https://serpapi.com/legal | Terms and Legal Shield limits | 2026-07-13 | CURRENT |
| SERPAPI-PRICE-MONITOR | Price Monitoring use case | SerpApi | https://serpapi.com/use-cases/price-monitoring | Provider explicitly supports price-monitoring use cases | 2026-07-13 | CURRENT |
| OPENAI-PROJECTS | Projects in ChatGPT | OpenAI | https://help.openai.com/en/articles/10169521-projects-in-chatgpt | Upload project sources and add project instructions | 2026-07-13 | CURRENT |

## Change procedure

When an official source changes:

1. record the old and new fact;
2. cite the exact official URL and check date;
3. identify affected contracts, tests, listing copy, and demo;
4. update machine-readable policy/data files;
5. add or update tests;
6. do not silently patch behavior in code only.
