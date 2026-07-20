# Nobu OKX Agent-Native Paid Monitoring — Architecture (Lane 7.4A, repaired 7.4A.1, partially implemented 7.4B/7.4C, repaired 7.4C.1)

**Status:** MOSTLY PROPOSED / RESEARCH, with §3.2–§3.5 (Lane 7.4B) and §3.1 steps 2–3/§3.3/§7.2 eligibility-gate/§8 (Lane 7.4C, repaired by 7.4C.1) now IMPLEMENTED. The live contract remains `openapi/nobu-a2mcp.openapi.yaml` for the three original actions; the six Lane 7.4B/7.4C actions are additionally live on the same `/v1/agent` route (`app/v1/agent/route.ts`) as a backward-compatible extension. `PREFLIGHT_MONITORING` never activates monitoring (Lane 7.4C.1 repair — see §3.3). Payment (§5–§7.7 activation mechanics) remains undeployed, gated on Lane 7.4D.0/7.4D.

**Date:** 2026-07-20 (Lane 7.4A) — repaired 2026-07-20 (Lane 7.4A.1) — partially implemented 2026-07-20 (Lane 7.4B, Lane 7.4C) — repaired 2026-07-20 (Lane 7.4C.1)
**Lane:** 7.4C.1 — Pre-payment activation and roadmap repair
**ASP #5541:** unchanged (free, `PENDING_REVIEW`) — this lane does not edit or resubmit it. The roadmap no longer waits for its review to resolve before continuing 7.4 development — see §12.

## 0. Research provenance and honesty note

This lane's own research session could not reach OKX's documentation domains: `web3.okx.com` and `www.okx.com` returned DNS `ENOTFOUND` for every attempt, and `okx.ai` / `www.okx.ai` returned `HTTP 403` (reachable, bot-blocked). Wayback/archive mirrors are blocked by tool policy in this environment. This session did **not** personally fetch or read any `web3.okx.com` page, in either the original Lane 7.4A pass or this 7.4A.1 repair. Full detail is in `docs/external-source-registry.md` under "Lane 7.4A / 7.4A.1 — OKX agent-native paid monitoring research."

**Source purity rule (7.4A.1):** every claim below about OKX.AI, A2MCP, Agentic Wallet, ASP registration, x402 payments, marketplace pricing, settlement networks/assets, review behavior, or listing topology rests only on official OKX/Onchain OS documentation or the coordinator-provided official findings recorded in the registry. The original 7.4A pass also cited `x402.org`, Cloudflare's documentation, this environment's packaged `okx-agent-payments-protocol` skill, WebSearch synthesis, and a generic Solana `SettlementCache` detail to corroborate or infer OKX-specific behavior. **All of those citations are removed from this document as of 7.4A.1** — none of them appear below as support for an OKX-specific claim. They are retained only as a historical record in the registry, marked as removed and why.

Five OKX-specific facts used below are **coordinator-provided**, not self-fetched: the task coordinator had working access to `web3.okx.com/onchainos/dev-docs/okxai/registerasp`, `.../okxai/howtomcp`, `.../payments/api-http`, and `.../payments/service-seller-reverseproxy`, and supplied their content (including a worked X Layer settlement example) directly. These are recorded as `OKX-REGISTER-2`, `OKX-A2MCP-2`, `OKX-PAY-HTTP`, `OKX-PAY-PROXY`, `OKX-XLAYER-EXAMPLE` in the external source registry and are treated as official-source evidence, but this document never claims this session independently verified them.

## 1. Confirmed official OKX capabilities (OKX official documentation only)

- A2MCP registration takes a service name, description, a price per call, and one endpoint. **Price `0` means a free service** (`OKX-REGISTER-2`).
- The registered endpoint is documented as one of two forms (`OKX-A2MCP-2`):
  1. **free** — returns the result directly with `HTTP 200`;
  2. **x402 pay-per-call** — returns `HTTP 402` before payment and replay.
- The seller-side payment flow is: protected request → `HTTP 402` payment challenge → signed payment → request replay (`OKX-PAY-HTTP`).
- OKX's reverse-proxy payment infrastructure **can technically contain free and paid routes** (`OKX-PAY-PROXY`) — this is a statement about infrastructure capability, not about the A2MCP marketplace listing rule, and is **not** treated as proof that one A2MCP listing may mix free and paid actions. See §5.
- Official X Layer settlement example (`OKX-XLAYER-EXAMPLE`): network `eip155:196`; asset **USD₮0**; asset address `0x779ded0c9e1022225f8e0630b35a9b54be713736`; decimals `6`; a `$0.99` display amount equals `990000` base units.

## 2. Undocumented or blocked capabilities

Kept explicitly unresolved — not established by any official OKX source reachable or supplied this session, and not to be inferred from any non-OKX source:

- Whether **one A2MCP listing** may mix free and paid actions.
- Whether Nobu may register **multiple differently priced ASP listings**.
- Whether ASP `#5541` may **change price while under review**, and what resubmission that would require.
- Whether OKX forwards a **verified user identity or email** to the ASP.
- Whether OKX forwards a **reusable cross-call authorization credential** the ASP can rely on between requests.

None of these are resolved by this lane. They gate Lane 7.4D, via Lane 7.4D.0's "official OKX paid-service topology re-check" (§12) — which is not itself blocked on ASP `#5541`'s free-listing review resolving; that review runs independently, and `#5541` is not edited or resubmitted before Lane 8R (§12).

## 3. Identity architecture — selected

**Selected: agent-native short-code email verification, Nobu-issued and Nobu-verified, independent of whatever OKX identity signal may or may not exist.**

This is not an emergency fallback adopted only because OKX proof was unobtainable. Even if a future OKX release supplies a verified identity or email to the ASP, Nobu still needs to independently confirm that the specific mailbox receiving price-drop alerts is one the requesting user actually controls, because:

- price-drop alerts are private, purchase-linked communications — Nobu, not OKX, is accountable for who receives them;
- an OKX-supplied identity (if one ever exists) would attest to *wallet/account* control, not necessarily to *mailbox* control, and Nobu's existing durable auth model (`src/auth/`) is already built around a verified-email account, not a wallet address;
- reusing the existing durable Postgres `AuthStore` (accounts, sessions, purchase blobs) keeps one source of truth for "who owns this purchase and where do alerts go," rather than introducing a second, wallet-keyed identity system that the monitoring/notification stack would need to reconcile against.

### 3.1 Agent flow, in order

1. `UNDERSTAND_PURCHASE` (free, live today) — natural-language purchase intake.
2. `DISCOVER_PRODUCT` (free, proposed) — returns bounded Target candidates plus an expiring, server-issued `discovery_session_id`. **Discovery does not require prior email verification** and creates no durable owned purchase.
3. The user selects the exact product; the agent calls `CONFIRM_PRODUCT` (free, proposed) with `discovery_session_id` + `candidate_id`. The server reloads and revalidates the held candidate snapshot (same pattern as `src/matching/confirm.ts`) and locks a fingerprint **against the discovery session**, not against any account — still no durable owned purchase, and no private monitoring state exists yet.
4. `BEGIN_EMAIL_VERIFICATION` (free, proposed) — the agent submits an email address. **Nobu sends the code by email. The user reads it and enters it in the AI-agent conversation. The agent submits it to Nobu.**
5. The user reads the code from their inbox and tells the agent.
6. `VERIFY_EMAIL_CODE` (free, proposed) — the agent submits the code. On success, Nobu creates (or reuses) a verified `agent_connections` row and returns a `connection_id` **and** a high-entropy `connection_token`, shown once. From this point on, a verified connection exists.
7. The agent asks the user for explicit **monitoring consent** and records the user's explicit answer.
8. The agent asks the user for explicit **email-alert consent** and records the user's explicit answer.
9. `PREFLIGHT_MONITORING` (free, proposed) — the agent submits `connection_id` + `connection_token` + `discovery_session_id` + both consent booleans. Only here does Nobu materialize a durable, account-owned `purchases` row from the discovery session's locked fingerprint, run the full deterministic eligibility check (§8), record both consents durably, and — only on a full pass — mint a `monitoring_enrollment_quotes` row and return `MONITORING_PAYMENT_READY`.
10. A genuine OKX payment occurs against the quote, through whichever marketplace topology Lane 7.4D's capability re-check ultimately supports.
11. `START_MONITORING` (paid, proposed) — consumes the settled payment and activates monitoring exactly once.

The website remains optional at every step; no step above requires a browser visit.

### 3.2 Agent authorization — connection handle plus secret credential

A `connection_id` is a **non-secret record handle only**. It identifies which connection a request refers to, the same way `purchase_id` identifies a purchase — it must never, by itself, authorize a private action. Every protected agent action (anything after step 6 above) requires **both**:

- the `connection_id` (handle), and
- a valid, unexpired `connection_token` (secret credential) matching the stored `connection_token_hash`.

`agent_connections` fields:

- `connection_id` — non-secret handle.
- `connection_token` — high-entropy, returned exactly once (at `VERIFY_EMAIL_CODE` success, and again on any future rotation) and never stored in plaintext or logged.
- `connection_token_hash` — `sha256Hex`-style hash stored server-side, matching the existing `src/auth/crypto.ts` pattern used for magic-link tokens and sessions.
- `credential_expires_at` — the token itself expires independent of the connection record; an expired token requires rotation, not a brand-new email re-verification, as long as the connection is not revoked.
- `credential_rotated_at` — set whenever the token is rotated; the prior token hash is invalidated at rotation.
- `revoked_at` / `status` — revocation state (§3.5); a revoked connection has no valid token regardless of `credential_expires_at`.

An agent action carrying a `connection_id` but a missing, wrong, expired, or hash-mismatched `connection_token` fails with `ACTION_NOT_AUTHORIZED` — identical treatment to a connection that does not exist, so a caller cannot distinguish "wrong secret" from "no such connection" by response shape.

### 3.3 Discovery session (pre-identity) — IMPLEMENTED (Lane 7.4C)

```
discovery_sessions
  id                     TEXT PK   (disc_*)
  structured_snapshot_json TEXT     -- validated structured purchase fields only (price, date, channel/location,
                                     -- product clues); never raw purchase_text — DISCOVER_PRODUCT does not accept it
  purchase_text_hash      TEXT NULL  -- reserved for a future raw-text intake path; unused while DISCOVER_PRODUCT
                                      -- only accepts already-validated structured fields (never populated today)
  candidates_snapshot_json TEXT      -- server-held candidate set, same 30-minute-freshness pattern as the existing web confirm flow
  selected_candidate_id    TEXT NULL
  locked_fingerprint_snapshot_json TEXT NULL  -- set by CONFIRM_PRODUCT
  status                  TEXT      -- discovering | confirmed | materialized
  materialized_purchase_id TEXT NULL -- set atomically by PREFLIGHT_MONITORING; the idempotency anchor for retries
  created_at              TEXT
  expires_at              TEXT      -- 30 minutes, matching the existing discovery-candidate freshness bound
```

A `discovery_sessions` row never carries an `account_id` or `connection_id` while `status` is `discovering` or `confirmed`. `PREFLIGHT_MONITORING` (§3.1 step 9) is the only action that reads a `confirmed` discovery session, and it does so only once a valid `connection_id`/`connection_token` pair is present in the same request. It first reserves materialization with an atomic `status='confirmed' → materialized_purchase_id=X` compare-and-set (first caller wins; a losing concurrent/retried call reads back the winner's `materialized_purchase_id` and reuses it — no second purchase is ever created). A `discovering` or `confirmed` session that expires before materialization is simply discarded; nothing durable or account-owned was ever created from it.

**Implementation note on ordering:** the purchase row is materialized (inserted) *before* the deterministic eligibility/window check runs, matching the exactly-once reservation above — but the locked fingerprint is attached only *after* eligibility passes, and even then **`PREFLIGHT_MONITORING` never activates monitoring**. Fingerprint attachment uses `confirmAndPersistLockedFingerprintPending` (`src/matching/store.ts`, Lane 7.4C.1), which persists the locked fingerprint exactly like the consumer web flow's `confirmAndPersistLockedFingerprint` but leaves `purchases.status` at the truthful, scheduler-ineligible `MONITORING_PAYMENT_READY_STATUS` instead of `MONITORING_ACTIVE`. Only Lane 7.4D's `START_MONITORING`, after verified `$0.99` payment, may transition a purchase to `MONITORING_ACTIVE`. An ineligible purchase (`UNSUPPORTED_PURCHASE` / `POLICY_EXCLUSION` / `WINDOW_EXPIRED` / `POLICY_STALE`) still gets a durable purchase row (so a later status lookup is meaningful), but never a fingerprint, never `MONITORING_PAYMENT_READY_STATUS`, never `MONITORING_ACTIVE`, and never a quote. (Lane 7.4C's original implementation called `confirmAndPersistLockedFingerprint` directly here, which incorrectly activated monitoring before any payment — repaired by Lane 7.4C.1.)

### 3.4 Email verification code properties (all required)

- **At least six numeric digits.**
- **Short-lived** — expires in 10 minutes (new constant `AGENT_EMAIL_CODE_TTL_MS`, shorter than the existing magic-link TTL because it is user-typed, not clicked).
- **Single-use** — first successful `VERIFY_EMAIL_CODE` consumes it; concurrent/replayed verification attempts lose, matching the existing `markLoginTokenUsed` compare-and-set pattern in `src/auth/auth-store.ts`.
- **Attempt-limited** — a fixed number of wrong-code attempts (e.g. 5) exhausts the challenge and forces a new `BEGIN_EMAIL_VERIFICATION`.
- **Rate-limited** — per-email and per-IP/agent-key buckets, reusing the existing `auth_rate_limits` table pattern (`emailBucket` in `src/auth/service.ts`).
- **Bound to one connection request and email** — the code hash is stored alongside the target `email_normalized` and the `connection_id` it was issued for; a code cannot verify a different connection or a different email.
- **Stored hashed** — same `sha256Hex` pattern already used for magic-link tokens and sessions (`src/auth/crypto.ts`); the raw code is never persisted, logged, or included in proof bundles.
- **Unusable for website authentication** — the code, and the `connection_token` it ultimately yields, have no relationship to `auth_login_tokens` or `auth_sessions`. An agent connection cannot sign into the website, and a website session cannot authorize agent-native monitoring actions.

```
agent_email_codes
  id                    TEXT PK
  connection_id         TEXT      -- FK agent_connections.id
  email_normalized       TEXT
  code_hash              TEXT      -- sha256Hex(code), code is >= 6 numeric digits
  expires_at             TEXT
  attempt_count           INTEGER  DEFAULT 0
  used_at                TEXT NULL
  created_at              TEXT
```

Both `agent_connections` and `agent_email_codes` live in the same durable Postgres store as `auth_accounts` / `auth_login_tokens` (`src/auth/durable-schema.ts` pattern), not in the per-instance SQLite/browser-cookie snapshot that Lane 7.3A.2A.1R already fixed for exactly this class of bug — a connection and its credential must be visible from any Vercel instance the next A2MCP call happens to land on.

### 3.5 Revocation

`REVOKE_AGENT_CONNECTION` sets `agent_connections.status = 'revoked'` and `revoked_at`, and invalidates the current `connection_token_hash`. Revoking a connection:

- immediately blocks that connection from any further protected agent action, regardless of whether the caller still holds a not-yet-expired `connection_token`;
- does **not** delete or stop monitors already started (see §9 — revocation is not a silent way to erase a paid activation);
- does **not** retroactively invalidate past email verification for audit purposes (the historical `agent_email_codes`/`agent_connections` rows stay, hashed, for the security audit trail).

## 4. Consent

For the `$0.99` monitored-product service, both of the following must be recorded as durable, timestamped facts **before `PREFLIGHT_MONITORING` mints a payment quote**:

- `monitoring_consent = true`
- `email_alert_consent = true`

Both are captured conversationally (§3.1 steps 7–8) and submitted together on the `PREFLIGHT_MONITORING` call; neither is inferred from the user having reached that step in the conversation. `email_alert_consent` may be revisited later via `ENABLE_EMAIL_ALERTS` / `DISABLE_EMAIL_ALERTS` (§10) without affecting `monitoring_consent` or the underlying monitor. This extends the existing Lane 7.3B `purchase_email_alert_prefs` / `email_alerts_consent_at` durable-consent pattern to also cover the base monitoring consent, which today is implicit in "user clicked Find my product" on the web flow.

## 5. Payment topology — unresolved, none selected

Per §1 and §2, an A2MCP endpoint is registered with one price and is documented as one of two forms (free-direct, or x402-paid), and OKX's reverse-proxy infrastructure being technically capable of hosting mixed routes does not establish that one **A2MCP listing** may do so. No topology is selected in this lane. Three possibilities are documented, all unresolved, all requiring official OKX confirmation before implementation:

1. **One mixed free/paid A2MCP listing** — the existing `/v1/agent` endpoint (or `#5541`) branches per request between a free `200` and an x402 `402`, based on which action is called. **Only viable if official OKX evidence permits it** — not established either way by §1's facts.
2. **Separate free and paid A2MCP listings** — the free orchestration actions (`UNDERSTAND_PURCHASE` through `PREFLIGHT_MONITORING`) stay on one listing, and a second, separately registered listing carries exactly one paid activation action. **Only viable if official OKX evidence permits one provider to hold multiple differently priced listings** — not established either way by §1's facts.
3. **Convert the current service to paid and relocate free preparation elsewhere** — `#5541` (or its successor) becomes the paid activation surface, and the free orchestration actions move to the web product and/or a separate free listing. Requires resolving whether `#5541` may change price while under review (§2), and is the most disruptive to the existing live free listing.

**None of the three is selected.** `#5541` remains free, unchanged, and under review throughout this lane. Lane 7.4D.0, the "official OKX paid-service topology re-check," resolves which possibility (if any) official OKX evidence supports; Lane 7.4D only proceeds to implementation once one is confirmed. If none is confirmed, Lane 7.4D.0 returns `NOBU_LANE_7_4D_0_BLOCKED` (§12).

## 6. Durable records (topology-independent)

These records do not depend on which of the three topology possibilities in §5 is eventually selected:

```
monitoring_enrollment_quotes
  id                      TEXT PK   (quote_*)
  connection_id            TEXT      -- agent_connections.id
  account_id               TEXT      -- resolved account (agent_connections.account_id)
  purchase_id               TEXT      -- the purchase row materialized from discovery_sessions at PREFLIGHT_MONITORING
  fingerprint_id             TEXT      -- locked product fingerprint
  price_amount               NUMERIC   -- 0.99
  price_currency              TEXT      -- "USD" (display)
  settlement_asset            TEXT NULL -- expected default per OKX-XLAYER-EXAMPLE: USD₮0 — confirmed only once Lane 7.4D selects a topology
  settlement_network           TEXT NULL -- expected default per OKX-XLAYER-EXAMPLE: eip155:196 (X Layer) — confirmed only once Lane 7.4D selects a topology
  monitoring_deadline           TEXT      -- copied from the Target policy window at quote time
  consent_monitoring_at          TEXT      -- durable, required non-null before this row can exist
  consent_email_alerts_at         TEXT      -- durable, required non-null before this row can exist
  status                           TEXT      -- issued | expired | consumed | superseded
  expires_at                       TEXT      -- short TTL (e.g. 15 minutes) — a stale quote fails closed, not silently re-priced
  created_at                       TEXT

payment_attempts
  id                       TEXT PK   (pay_*)
  quote_id                  TEXT      -- FK monitoring_enrollment_quotes.id
  x402_challenge_ref          TEXT      -- opaque reference to the issued 402 challenge (not the raw payload)
  status                       TEXT      -- challenged | verifying | settled | failed | expired
  settlement_ref                TEXT NULL -- OKX-provided settlement/transaction reference once settled — this, not any caller-supplied value, anchors activation identity
  created_at                     TEXT
  settled_at                      TEXT NULL

monitor_activations
  id                        TEXT PK   (act_*)
  quote_id                   TEXT UNIQUE -- FK; UNIQUE enforces exactly-one activation per quote
  activation_key               TEXT UNIQUE -- server-derived only, see §7.3 — never accepts a caller-supplied value
  payment_attempt_id           TEXT      -- FK payment_attempts.id (the one that settled)
  purchase_id                   TEXT      -- FK purchases.id
  monitor_id                     TEXT      -- the purchase_id already IS Nobu's monitor id (reuse, no new id space)
  created_at                      TEXT
```

`monitoring_enrollment_quotes` and `payment_attempts` are new; `monitor_activations` is a thin ledger row that reuses the existing `purchases` table as the actual monitor record (§7.7 explains why no parallel "monitor" entity is introduced).

## 7. Payment ⇄ monitoring interaction rules

### 7.1 Free steps never touch payment

`UNDERSTAND_PURCHASE`, `DISCOVER_PRODUCT`, `CONFIRM_PRODUCT`, `BEGIN_EMAIL_VERIFICATION`, `VERIFY_EMAIL_CODE`, `PREFLIGHT_MONITORING`, `CHECK_MONITORING_STATUS`, `LIST_ACTIVE_MONITORS`, `ENABLE_EMAIL_ALERTS`, `DISABLE_EMAIL_ALERTS`, `STOP_MONITORING`, `REVOKE_AGENT_CONNECTION` never create a `payment_attempts` row and never appear behind an `HTTP 402`, under any of the §5 topology possibilities. Only the single activation action does.

### 7.2 `PREFLIGHT_MONITORING` is the free/paid boundary — `MONITORING_PAYMENT_READY`, not `PAYMENT_REQUIRED`

`PREFLIGHT_MONITORING` runs the full deterministic eligibility check (§8) against the newly materialized purchase and, only if every condition already passes — including both durable consents (§4) — mints a `monitoring_enrollment_quotes` row and returns status **`MONITORING_PAYMENT_READY`** with the quote id and price. If any condition fails, it returns the specific failure status (`UNSUPPORTED_PURCHASE`, `MATCH_REVIEW_REQUIRED`, `CONSENT_REQUIRED`, `EMAIL_VERIFICATION_REQUIRED`, etc. — §10) and **no quote is minted**. This guarantees unsupported purchases never reach payment.

`MONITORING_PAYMENT_READY` is a Nobu status field in a `200` JSON body — it is not an `HTTP 402` and carries no `PAYMENT-REQUIRED` header. The actual `HTTP 402` challenge, and the `PAYMENT-REQUIRED`/`WWW-Authenticate: Payment` mechanics from §1, belong exclusively to the protected OKX payment resource that `START_MONITORING` (or its topology-specific equivalent) fronts. Nobu's own free preflight response is never itself a payment challenge.

### 7.3 Activation identity is derived server-side — no caller-supplied idempotency key

Nobu derives the `monitor_activations.activation_key` **entirely server-side**, from: the quote ID; the verified settlement reference (`payment_attempts.settlement_ref`, populated only once OKX confirms settlement); the confirmed `purchase_id`; and the locked `fingerprint_id`. No request to `START_MONITORING` (or its topology-specific equivalent) accepts or trusts a caller-supplied idempotency key of any kind — a client-provided value, if sent, is ignored, never cross-checked, never used to determine identity.

### 7.4 First valid paid replay creates exactly one monitor; a valid replay after activation is `200 ALREADY_ACTIVE`, never `409`

1. Payment settles; OKX supplies a settlement reference, which Nobu records on `payment_attempts.settlement_ref`.
2. In **one durable PostgreSQL transaction**, the activation handler: re-validates the quote is `issued` and unexpired → marks it `consumed` → inserts one `monitor_activations` row keyed on the server-derived `activation_key` (`UNIQUE`, so a concurrent duplicate insert fails, not creates a second row) → flips the underlying `purchases.status` to `MONITORING_ACTIVE` using the existing monitoring-start code path (`src/monitoring`), unchanged. All three effects (quote-consume, activation-ledger insert, monitoring-state transition) commit together or not at all.
3. A **valid replay after activation** (duplicate settlement notification, retried client, re-sent payment header for the same settlement) that resolves to the same `activation_key` finds the row already present and returns **`HTTP 200`**, status `ALREADY_ACTIVE`, and the **original `monitor_id`** — never `HTTP 409`, and never a second `purchases` or `monitor_activations` row. `409` is reserved for genuine conflicts (e.g. a tampered request that doesn't match the stored quote at all — §7.5), not for a legitimate replay of an already-successful activation.

### 7.5 Altered or expired quote fails closed

If the `purchase_id`, `fingerprint_id`, or price on the incoming activation request don't match the stored quote exactly, or the quote's `expires_at` has passed, activation fails with `CONNECTION_EXPIRED` and does **not** fall back to re-deriving eligibility on the fly. The caller must re-run `PREFLIGHT_MONITORING` to mint a fresh quote. Payment already collected against an expired or altered quote is never silently reused for a re-priced or re-matched purchase — that would let payment override eligibility, which is explicitly forbidden.

### 7.6 Reconciliation: payment settled externally, activation transaction did not commit

Because §7.4's three effects are one transaction, the only inconsistent state possible is: OKX confirms settlement and Nobu records `payment_attempts.status = 'settled'`, but the activation transaction (quote-consume + ledger insert + monitoring-state flip) never commits — a process crash, a database outage, or a deploy boundary between "settlement recorded" and "activation transaction attempted." In this state the quote is still `issued` (not `consumed`) even though a real, verified settlement exists. This must **never** be resolved by silently accepting a second payment: a reconciliation job (a defined, required Lane 7.4D build item, not implemented by this documentation-only lane) must periodically scan for `payment_attempts.status = 'settled'` rows with no matching `monitor_activations` row and retry the activation transaction using the already-recorded `settlement_ref` — never by asking OKX or the user to pay again for the same quote.

### 7.7 No parallel monitor entity

`monitor_id` in every proposed response is the existing `purchases.id` — the same identifier the current `CHECK_MONITORING_STATUS` action already returns as `purchase_id`. This lane does not introduce a second "monitor" table or id space; `monitor_activations` is a payment-ledger fact ("this purchase's monitoring was activated via this payment"), not a competing source of truth for monitoring state. `src/monitoring/scheduler.ts`, `src/monitoring/store.ts`, and the Lane 7.3B notification pipeline (`src/notifications/`) are reused unmodified — an agent-originated paid monitor is, from the scheduler's perspective, just another `MONITORING_ACTIVE` row with `fingerprint_id` set, exactly like a web-originated one.

## 8. Deterministic boundaries (unchanged from existing AI boundary, extended)

The AI boundary already in `AGENTS.md` and `docs/nobu-privacy-security-threat-model.md` extends unchanged to the agent-native flow:

- The agent may parse, explain, and relay codes/prompts, but never chooses the confirmed product — `CONFIRM_PRODUCT` requires the user to pick a specific `candidate_id` from server-returned candidates, using the same reload-and-revalidate pattern already implemented in `src/matching/confirm.ts`, reused verbatim, now scoped to a `discovery_session_id` instead of an account (§3.3).
- No durable, account-owned purchase and no private monitoring state exist before a verified connection (§3.2–§3.3) is present on the request.
- `PREFLIGHT_MONITORING` only materializes a purchase and mints a quote once the discovery session is `confirmed`, the connection is verified and unexpired, and **both** durable consents (§4) are recorded.
- `START_MONITORING` (or its topology-specific equivalent, §5) only succeeds against a `monitoring_enrollment_quotes` row that is `issued`, unexpired, and whose server-derived `activation_key` has not already produced a `monitor_activations` row — payment verification is necessary but never sufficient; a settled payment against an expired or already-consumed quote still fails closed (§7.5).
- Monitoring activation requires, all together: a verified connection (§3), a materialized purchase with a locked fingerprint from a `confirmed` discovery session (§3.3), supported Target.com/app purchase + Target seller + Target Plus exclusion (existing `src/policy`), an active monitoring window (existing policy engine), both durable consents (§4), and verified `$0.99` settlement. Any single missing item fails closed with the matching status from §10 — never a partial activation.

## 9. Stop versus archive

Archive (Lane 7.3A.2B) remains **visibility-only** and is unchanged. `STOP_MONITORING` is a distinct, explicit lifecycle transition and must **not** reuse the archive mechanism:

```
purchases (new columns)
  monitoring_stopped_at    TEXT NULL
  monitoring_stop_reason    TEXT NULL   -- fixed value at launch: "user_requested"
```

- `STOP_MONITORING` sets `monitoring_stopped_at` and `monitoring_stop_reason = 'user_requested'`. It does not set or clear the existing archive flag, and does not delete the `monitor_activations`/`payment_attempts` audit trail.
- Once `monitoring_stopped_at` is set, the purchase must no longer be selected by the scheduler — the existing active-purchase selection query (`src/monitoring/selection.ts`) must exclude any row with `monitoring_stopped_at IS NOT NULL`, in addition to its existing window/status checks. This is a required Lane 7.4E implementation detail, not implemented by this documentation-only lane.
- `REVOKE_AGENT_CONNECTION` (§3.5) and `STOP_MONITORING` never touch `monitor_activations` or payment records, and no response body, email, or status message issued by either action promises or implies a refund. Response text for both is reviewed against the existing locked-language list in `docs/nobu-clean-master-spec.md` §9 before implementation.

## 10. Proposed action contract and statuses

All actions below are **proposed**, additive to the existing three live actions. None are implemented by this lane.

| Action | Free/Paid | Purpose |
|---|---|---|
| `UNDERSTAND_PURCHASE` | free (live today) | unchanged |
| `DISCOVER_PRODUCT` | free (proposed) | §3.1 step 2 — returns candidates + `discovery_session_id`; no connection required |
| `CONFIRM_PRODUCT` | free (proposed) | §3.1 step 3 — locks a fingerprint against the discovery session; no connection required |
| `BEGIN_EMAIL_VERIFICATION` | free (proposed) | §3.1 step 4 |
| `VERIFY_EMAIL_CODE` | free (proposed) | §3.1 step 6 — returns `connection_id` + one-time `connection_token` |
| `PREFLIGHT_MONITORING` | free (proposed) | §7.2 — the free/paid boundary; materializes the purchase and mints a quote only on full eligibility + consent pass |
| `START_MONITORING` | **paid** (proposed) | §7.4 — consumes a settled payment against a quote; exactly-once, server-derived identity |
| `CHECK_MONITORING_STATUS` | free (live today) | unchanged |
| `LIST_ACTIVE_MONITORS` | free (proposed) | owner-scoped list, reusing existing owner-scope rules from `src/web/session-owner.ts` |
| `ENABLE_EMAIL_ALERTS` / `DISABLE_EMAIL_ALERTS` | free (proposed) | agent-native equivalent of the existing `src/notifications/prefs.ts` toggle |
| `STOP_MONITORING` | free (proposed) | §9 |
| `REVOKE_AGENT_CONNECTION` | free (proposed) | §3.5 |

### Continuation statuses (proposed, additive to the existing `A2mcpStatus`/agent response vocabulary)

| Status | Meaning |
|---|---|
| `MORE_INFORMATION_REQUIRED` | purchase intake incomplete; mirrors existing `UNDERSTAND_PURCHASE` behavior |
| `PRODUCT_CONFIRMATION_REQUIRED` | candidates returned, awaiting explicit `CONFIRM_PRODUCT` |
| `EMAIL_VERIFICATION_REQUIRED` | no active `agent_connections` row for this conversation |
| `EMAIL_CODE_SENT` | `BEGIN_EMAIL_VERIFICATION` succeeded; awaiting `VERIFY_EMAIL_CODE` |
| `EMAIL_VERIFIED` | connection active; `connection_token` issued |
| `CONSENT_REQUIRED` | monitoring and/or email-alert consent not yet given |
| `MONITORING_PAYMENT_READY` | `PREFLIGHT_MONITORING` passed; quote minted, awaiting genuine OKX payment (§7.2 — not an HTTP 402 itself) |
| `PAYMENT_PENDING` | payment challenged/verifying, not yet settled |
| `MONITORING_STARTED` | first successful activation for this quote |
| `MONITORING_ACTIVE` | existing status, unchanged |
| `PRICE_DROP_DETECTED` | existing status, unchanged |
| `ALREADY_ACTIVE` | replayed activation resolving to an already-consumed quote; returned with `HTTP 200`, never `409` (§7.4) |
| `ACTION_NOT_AUTHORIZED` | missing/invalid/expired connection token, revoked connection, or action targets a purchase the connection does not own |
| `CONNECTION_EXPIRED` | connection credential or quote expired/altered (§7.5) |
| `UNSUPPORTED_PURCHASE` | existing status, unchanged |

## 11. Reused vs new components

**Reused unmodified:** `src/matching/*` (discovery, confirm, evaluate), `src/policy/*` (Target eligibility, window calc), `src/monitoring/*` (scheduler, budget, runner, selection, store — selection extended per §9 to exclude stopped purchases), `src/notifications/*` (prefs, ledger, process, email-send — Lane 7.3B's consent + idempotency + anti-spam machinery), `src/auth/auth-store.ts`'s durable-Postgres pattern (new tables added to the same store, not a new database).

**New:** `discovery_sessions`, `agent_connections`, `agent_email_codes`, `monitoring_enrollment_quotes`, `payment_attempts`, `monitor_activations` tables; two new `purchases` columns (`monitoring_stopped_at`, `monitoring_stop_reason`); the twelve proposed actions in §10; the identity/authorization flow in §3; the consent contract in §4; the topology-independent payment mechanics in §6–§7.

**Explicitly not built in parallel:** no second scheduler, no second notification system, no second "monitor" entity, no second purchase-ownership model. "Ongoing monitoring through OKX" means enrollment/confirmation/payment/consent/management happen through the agent conversation, but Nobu's existing protected server scheduler performs all later checks and the existing Lane 7.3B email pipeline sends all alerts — the user never needs to keep the agent conversation open.

## 12. Build order adopted

- **Lane 7.4A — Research and architecture.** Complete on PASS (2026-07-20).
- **Lane 7.4A.1 — Official-OKX source cleanup and agent-monitoring contract repair.** This document. Documentation and proposed-contract repair only.
- **Lane 7.4B — Agent connection and conversational email verification. COMPLETE.** Implemented §3.2–§3.5 (`agent_connections`, `agent_email_codes`, `BEGIN_EMAIL_VERIFICATION`, `VERIFY_EMAIL_CODE`, `REVOKE_AGENT_CONNECTION`, connection-token issuance/rotation/revocation). Did not require the payment topology decision. Evidence: `docs/proof/lane-7-4b-agent-connection/`.
- **Lane 7.4C — Free agent-native discovery, confirmation, consent and monitoring preflight. COMPLETE (repaired by 7.4C.1).** Implemented `DISCOVER_PRODUCT`, `CONFIRM_PRODUCT`, `discovery_sessions` (§3.3, now including `structured_snapshot_json`), consent capture (both `monitoring_consent`/`email_alert_consent` required true, checked in the service layer rather than schema-enforced so a `false` yields a truthful `CONSENT_REQUIRED` instead of a generic 400), `PREFLIGHT_MONITORING`, purchase materialization, and `monitoring_enrollment_quotes` (§6, `settlement_asset`/`settlement_network` left `NULL` pending Lane 7.4D). Reused `src/matching/discovery-candidates.ts`, `src/matching/confirm.ts`, `src/policy/evaluate-target-policy.ts`, and the Lane 7.4B `authorizeAgentConnection` helper — no parallel implementation. Idempotency: an atomic `discovery_sessions` reservation (first caller wins) plus a partial-unique index on `monitoring_enrollment_quotes(purchase_id) WHERE status='issued'` guarantee retries/concurrency never create a second purchase or a second active quote. Also did not require the payment topology decision. **Bug (repaired by 7.4C.1 below):** the original pass attached the locked fingerprint via `confirmAndPersistLockedFingerprint`, which also activated monitoring (`MONITORING_ACTIVE`) — before any payment existed. Evidence: `docs/proof/lane-7-4c-agent-preflight/`.
- **Lane 7.4C.1 — Pre-payment activation and roadmap repair. COMPLETE.** Replaced `PREFLIGHT_MONITORING`'s fingerprint-attach call with `confirmAndPersistLockedFingerprintPending` (`src/matching/store.ts`) — same persistence, but leaves the purchase in the truthful, scheduler-ineligible `MONITORING_PAYMENT_READY_STATUS` instead of `MONITORING_ACTIVE`; the web confirmation flow's `confirmAndPersistLockedFingerprint` is unchanged. Made preflight failure-recoverable (purchase-insertion retry after a successful session reservation recovers using the reserved id; quote-issuance failure returns a graceful error and can never leave an active purchase; retries/concurrency still produce exactly one purchase and one active quote; an existing valid quote is reused). Corrected this document and the Lane 7.4C proof bundle. **Roadmap correction:** removed the requirement to wait for ASP `#5541`'s current review before continuing 7.4 development — see the adopted order below. Evidence: `docs/proof/lane-7-4c-agent-preflight/` (updated).
- **Adopted roadmap order:** `7.4C.1 → 7.4D.0 → 7.4D → 7.4E → 7.4F → Lane 8R → 7.4G → Lane 9`. During 7.4D.0–7.4F: do not edit or resubmit `#5541`; do not expose unfinished paid behavior publicly; use only official OKX evidence for topology decisions. `#5541`'s existing free-listing review (`docs/nobu-build-order.md` Lane 8) runs independently and is not a blocking gate for this sequence.
- **Lane 7.4D.0 — Official OKX paid-service topology re-check.** Using only official OKX evidence available at that time: resolves which (if any) of the three §5 possibilities is supported, whether `#5541` may change price under review, and whether OKX forwards identity/a cross-call credential. **Returns `NOBU_LANE_7_4D_0_BLOCKED` if topology remains unresolved.** Does not edit or resubmit `#5541`.
- **Lane 7.4D — `$0.99` activation.** Only once Lane 7.4D.0 resolves a topology: implements `payment_attempts`, `monitor_activations`, `START_MONITORING`, and the exactly-once/idempotency/fail-closed/reconciliation behavior in §7. The only lane that may transition a purchase to `MONITORING_ACTIVE` from an agent-native quote.
- **Lane 7.4E — Agent-native monitor management.** `CHECK_MONITORING_STATUS` (already live) extended, `LIST_ACTIVE_MONITORS`, `ENABLE_EMAIL_ALERTS`/`DISABLE_EMAIL_ALERTS`, `STOP_MONITORING` (§9), scheduler-selection exclusion for stopped purchases. Does not edit or resubmit `#5541`.
- **Lane 7.4F — Scheduler and notification integration.** Proves agent-originated paid monitors flow through the existing scheduler/notification stack unmodified (§11). Does not edit or resubmit `#5541`.
- **Lane 8R — Accurate edit/resubmit of ASP #5541.** First point in the roadmap where `#5541` is edited or resubmitted since its original registration, done only once 7.4D–7.4F are built and proven, so the listing accurately describes what is genuinely live.
- **Lane 7.4G — Live marketplace end-to-end proof.** `agent request → product confirmation → email verification → consent → genuine $0.99 payment → monitor activation → scheduled monitoring → genuine eligible email alert → status retrieval → duplicate suppression`.
- **Lane 9 — Demo and submission closeout.**

## 13. Hard locks carried forward unchanged

Target.com/app only; Target seller only; Target Plus excluded; SerpApi remains third-party observed data; no direct Target scraping; no Target account login; no claim submission; no payment-card/password/2FA/wallet-key collection; no guaranteed-refund language; fail closed on ambiguity; no fake payments/users/revenue/transactions/alerts; ASP #5541 remains free, unchanged, and under review throughout this lane.
