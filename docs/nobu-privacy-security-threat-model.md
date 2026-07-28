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

## Agent-native paid monitoring (Lane 7.4A.1 — PROPOSED, not yet implemented)

`docs/nobu-okx-agent-native-paid-monitoring-architecture.md` designs, but does not deploy, an agent-native discovery, connection, email-verification, consent, and paid-activation surface. New threats to control for at implementation time (Lane 7.4B onward). Source note: this section rests only on official OKX facts and Nobu's own design choices — no non-OKX payment source is cited as authority for OKX-specific behavior (see `docs/external-source-registry.md`).

- **Premature private state:** discovery and product confirmation (`DISCOVER_PRODUCT`, `CONFIRM_PRODUCT`) run against an unauthenticated, expiring `discovery_session_id` and must never create a durable, account-owned purchase or expose any private monitoring state before a verified connection exists.
- **Handle-as-credential confusion:** `connection_id` is a non-secret record handle only; every protected agent action must require both `connection_id` and a valid, unexpired `connection_token` matching the stored `connection_token_hash` — a handle alone must never authorize a private action.
- **Email code brute-force / interception:** codes are weaker than magic-link tokens; mitigate with a minimum six numeric digits, short TTL, per-attempt lockout, per-email/IP rate limiting, and hashed-at-rest storage (same posture as existing login tokens). The code and the resulting `connection_token` must remain unusable for website authentication.
- **Connection scope creep:** a verified connection must not become a general-purpose bearer credential — it may create/manage monitors it created and read status for monitor IDs it already holds, never a blanket read of a website account's full purchase history.
- **Consent skipped or implied:** both `monitoring_consent` and `email_alert_consent` must be explicit, durable, timestamped facts recorded before `PREFLIGHT_MONITORING` mints a quote — never inferred from the user having reached that step.
- **Payment-authority confusion:** a settled `$0.99` payment must never be treated as proof of eligibility, matching, or consent — `PREFLIGHT_MONITORING` enforces those deterministically *before* a quote exists; payment only unlocks activation of an already-eligible, already-consented, already-quoted purchase. Nobu's own free preflight response (`MONITORING_PAYMENT_READY`) is never itself an `HTTP 402` — the real `402`/`PAYMENT-REQUIRED` challenge belongs exclusively to the protected OKX payment resource.
- **Caller-supplied idempotency spoofing:** activation identity (`monitor_activations.activation_key`) is derived entirely server-side from the quote id, the OKX-verified settlement reference, the confirmed purchase, and the locked fingerprint — no caller-supplied idempotency key is accepted or trusted for any purpose.
- **Duplicate settlement / replay:** exactly-once activation via the server-derived `activation_key` and a `UNIQUE(quote_id)` ledger row inserted in the same durable transaction as the quote-consume and monitoring-state transition; a valid replay of an already-settled activation returns `200 ALREADY_ACTIVE`, never `409` and never a second monitor.
- **Settled-but-uncommitted state:** if OKX confirms settlement but Nobu's activation transaction does not commit, this must never be resolved by accepting a second payment — a reconciliation job retries the recorded settlement reference against the still-`issued` quote.
- **Monitoring Pass pending settlement:** after OKX settle returns pending, Nobu stores an opaque settlement_ref and may poll settle/status on the hot path and via free RESOLVE with pass_continuation_id. Owner reconcile is emergency fallback only. Exactly one pass per UNIQUE settlement_ref; unpaid re-entry with continuation never re-issues a payment challenge.
- **Revocation/stop misunderstood as refund:** `REVOKE_AGENT_CONNECTION` and `STOP_MONITORING` (an explicit `monitoring_stopped_at`/`monitoring_stop_reason` state, distinct from the visibility-only archive lifecycle) must never imply money back or silently delete already-activated monitoring records.
- **Undocumented OKX identity/topology assumptions:** no official OKX source found or supplied confirms OKX forwards a verified user/email identity or a reusable cross-call authorization credential to the ASP, or that one A2MCP listing may mix free and paid actions — the design does not assume any of these now or ever will; Nobu's own email verification remains authoritative for the alert destination regardless, and no paid topology is implemented until Lane 7.4D confirms one from official OKX evidence.

## Platform eligibility

Never provide instructions to bypass OKX, retailer, payment, identity, age, region, or guardian restrictions. Account and agreement steps must be performed by an eligible person under the applicable terms.
