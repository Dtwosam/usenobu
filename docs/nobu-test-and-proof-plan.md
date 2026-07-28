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
- conversation contract fields on guidance, pass, and journey responses
  (`payment_status`, `second_payment_required`, `monitoring_active`,
  `journey_complete`, `retry_safe`, `fields`/`requiredArgs`);
- Monitoring Pass: unpaid first contact 402; pending settle polls settle/status;
  RESOLVE issues exactly one pass per settlement without scanning unrelated payments;
  continuation body on paid URL never re-challenges;
- marketplace journey: ordered stages; no second payment after recognized pass.

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

## 8. Agent-native paid monitoring (Lane 7.4B–7.4G — PROPOSED, not yet implemented)

Required cases once built (see `docs/nobu-okx-agent-native-paid-monitoring-architecture.md`):

- `DISCOVER_PRODUCT`/`CONFIRM_PRODUCT` succeed against a `discovery_session_id` with no connection present, and never create a durable owned purchase or expose private monitoring state before a verified connection exists;
- email verification code: at least six digits, short-lived expiry, single-use, attempt-limited, rate-limited, bound to one connection/email, hashed-at-rest, unusable as a browser session token;
- protected actions reject a request with a valid `connection_id` but a missing/wrong/expired `connection_token` (`ACTION_NOT_AUTHORIZED`), and a `connection_id` alone never authorizes anything;
- `CONFIRM_PRODUCT` reload-and-revalidate matches the existing web confirmation guarantees (reject stale/tampered/non-Target/Target Plus/title-only);
- `PREFLIGHT_MONITORING` never mints a quote for an unsupported/ambiguous/expired-window/missing-either-consent purchase, and returns `MONITORING_PAYMENT_READY` (not an HTTP 402) on pass;
- quote expiry fails closed (no silent re-price or re-match on activation);
- activation accepts no caller-supplied idempotency key; the server-derived `activation_key` (quote id + settlement reference + purchase + fingerprint) is the only identity source;
- first valid paid replay creates exactly one monitor; a valid replay resolving to an already-activated quote returns `HTTP 200` with status `ALREADY_ACTIVE` and the same `monitor_id` — never `HTTP 409` and never a second row;
- altered quote (mismatched purchase/fingerprint/price) is rejected, not repaired;
- a settled-but-uncommitted activation (payment confirmed, activation transaction did not commit) is recovered by reconciliation against the recorded settlement reference, never by collecting a second payment;
- revoking an agent connection does not delete or stop an already-activated monitor;
- `STOP_MONITORING` sets an explicit `monitoring_stopped_at`/`monitoring_stop_reason` state distinct from archive, is excluded from scheduler selection, and never implies a refund;
- agent-originated monitors are indistinguishable from web-originated monitors to the scheduler and notification pipeline (no parallel implementation);
- no live payment test runs fake/simulated settlement and calls it genuine.
