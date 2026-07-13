# Nobu Privacy and Security Threat Model

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

## Natural-language purchase intake (Lane 7.5E)

- Purchase description text is **untrusted**; treat as possible prompt-injection.
- Max length enforced (2000 characters).
- **Do not store or log raw purchase text** by default; audit logs may keep a hash, length, outcome, and provider only.
- Reject or redact card/bank/password/2FA/ID/wallet patterns.
- AI extraction never starts matching or monitoring; only user-confirmed structured fields enter deterministic systems.
- AI API keys (`GROQ_API_KEY`) are server-only; never expose provider payloads or secrets to the client.
- Separate stricter rate limits for `UNDERSTAND_PURCHASE` / AI actions.

## Primary threats

- SerpApi key exposure;
- AI provider key exposure (`GROQ_API_KEY`);
- insecure cron/monitor endpoint;
- cross-user purchase access;
- prompt injection from product titles, receipt text, or free-form purchase descriptions;
- model inventing prices, dates, or product identifiers;
- false product match causing misleading alerts;
- provider response tampering or stale data;
- abusive high-volume queries exhausting the free quota (SerpApi or AI);
- forged purchase data;
- deceptive guaranteed-refund language;
- unauthorized claim submission.

## Controls

- server-only secrets;
- authentication and per-user authorization;
- signed/internal scheduler calls;
- rate limiting (including AI-specific limits);
- schema validation (Zod) on AI structured output and structured purchase input;
- deterministic matching and policy engine as sole authority after confirmation;
- raw external text treated as untrusted data;
- injection stripping + sensitive-data rejection on NL intake;
- output escaping;
- provenance and timestamps;
- fail-closed statuses;
- audit logs without sensitive content or raw purchase text;
- no claim automation;
- clear disclaimer that Target verifies and decides;
- confirmation gate before Find my product / monitoring.

## Platform eligibility

Never provide instructions to bypass OKX, retailer, payment, identity, age, region, or guardian restrictions. Account and agreement steps must be performed by an eligible person under the applicable terms.
