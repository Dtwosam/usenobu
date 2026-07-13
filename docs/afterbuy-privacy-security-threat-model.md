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
