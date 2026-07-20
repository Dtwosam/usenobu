# Nobu Test and Proof Plan

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
- authorization on purchase records (owner-scoped list/read/confirm/check/alert; cross-user ≡ not found);
- two distinct session owners cannot see each other’s purchases (unit + Playwright);
- client-supplied owner/user/email ignored on create;
- ownerless / legacy shared rows quarantined;
- production fixture gate closed without env; Demo data banner absent on My Purchases;
- webhook/cron endpoint protection (scheduler separate from consumer auth);
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
