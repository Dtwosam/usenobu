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

## Purchase ownership (Lane 7.3A.2A + 7.3A.2A.1)

- **Guests** use browser-scoped ownership via server-minted `usr_*` in httpOnly `nobu_owner_v1` (middleware + actions). Guest storage is **not** a full account.
- **Verified accounts** use stable server-side `acct_*` IDs after passwordless email magic-link verification. Auth session is a separate httpOnly cookie (`nobu_auth_session_v1`); sessions rotate on login/logout; magic tokens are one-time and expiring.
- **Durable auth (7.3A.2A.1R):** accounts, login tokens, sessions, claim events, and account purchase blobs live in shared Postgres (not the browser purchase cookie snapshot). GET `/auth/verify` only peeks; POST confirmation consumes the token (email link previews cannot burn it).
- **Every new purchase has exactly one server-assigned owner** written to `purchases.user_ref` (account id when signed in, else guest id). Client-supplied user/owner/email fields are ignored.
- **Guest claim:** only the browser holding the guest cookie may transfer that guest’s eligible purchases to the verified account; atomic and idempotent; never claims ownerless, legacy `demo-user`, or another account’s rows; guest cookie is rotated after claim.
- **Logout** invalidates the auth session and does not delete purchase history or move account purchases back to guest ownership.
- **Email is private** — never log full addresses or raw tokens; never put them in proof bundles.
- **Consumer operations are owner-scoped:** list, read, confirm, manual check, alerts/history. Cross-user and unknown IDs both return the same generic **Purchase not found** result (no existence leak).
- **Ownerless historical rows** and **legacy shared `demo-user` rows** remain quarantined.
- **Fixtures never appear in normal production accounts.** Fixture discovery/check requires an explicit server gate.
- **Scheduler / internal monitoring** remains a separate protected boundary and may process across owners.

## Platform eligibility

Never provide instructions to bypass OKX, retailer, payment, identity, age, region, or guardian restrictions. Account and agreement steps must be performed by an eligible person under the applicable terms.
