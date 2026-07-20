# Nobu OKX Agent-Native Paid Monitoring — Architecture (Lane 7.4A)

**Status:** PROPOSED / RESEARCH — nothing in this document is deployed. The live contract remains `openapi/nobu-a2mcp.openapi.yaml` (free `UNDERSTAND_PURCHASE` / `CHECK_CONFIRMED_PURCHASE` / `CHECK_MONITORING_STATUS` only). This document proposes a **backward-compatible extension**, not a replacement.

**Date:** 2026-07-20
**Lane:** 7.4A — OKX agent-native paid monitoring research, architecture and build-order adoption
**ASP #5541:** unchanged (free, `PENDING_REVIEW`) — this lane does not edit or resubmit it.

## 0. Research provenance and honesty note

This lane's own research session could not reach OKX's documentation domains: `web3.okx.com` and `www.okx.com` returned DNS `ENOTFOUND` for every attempt, and `okx.ai` / `www.okx.ai` returned `HTTP 403` (reachable, bot-blocked). Wayback/archive mirrors are blocked by tool policy in this environment. This session did **not** personally fetch or read any `web3.okx.com` page. Full detail, including what generic x402.org/Cloudflare documentation this session *did* independently fetch, is in `docs/external-source-registry.md` under "Lane 7.4A — OKX agent-native paid monitoring research."

Four OKX-specific facts used below are **coordinator-provided**, not self-fetched: the task coordinator had working access to `web3.okx.com/onchainos/dev-docs/okxai/registerasp`, `.../okxai/howtomcp`, `.../payments/api-http`, and `.../payments/service-seller-reverseproxy`, and supplied their content directly. These are recorded as `OKX-REGISTER-2`, `OKX-A2MCP-2`, `OKX-PAY-HTTP`, `OKX-PAY-PROXY` in the external source registry and are treated as official-source evidence, but this document never claims this session independently verified them.

## 1. Confirmed official OKX capabilities (coordinator-provided + cross-corroborated)

- A2MCP registration requires a service name, description, a **fixed price per call**, and **one endpoint** (`OKX-REGISTER-2`).
- The registered endpoint must be one of exactly two compliant forms (`OKX-A2MCP-2`):
  1. **free** — returns the result directly with `HTTP 200`;
  2. **x402 pay-per-call** — returns `HTTP 402`, followed by signed payment and request replay.
- The seller-side HTTP flow is: protected resource → payment challenge → signed payment → replay (`OKX-PAY-HTTP`), with a documented reverse-proxy pattern for gating a protected resource behind x402 (`OKX-PAY-PROXY`).
- OKX's Agent Payments Protocol (buyer/agent side, confirmed via the packaged `okx-agent-payments-protocol` environment skill — `OKX-PAY-SKILL`) reuses the generic x402 vocabulary byte-for-byte: `x402Version`, `X-PAYMENT`, `PAYMENT-SIGNATURE`, `PAYMENT-REQUIRED`, `WWW-Authenticate: Payment`, with OKX extensions `intent=charge` (one-shot) and `intent=session` (channel + vouchers), plus a non-402 `a2a-pay` `paymentId`-link flow.
- A worked example in that skill labels EVM `chainId: 196` as **"X Layer"**, corroborating the pre-existing (2026-07-13, not re-verified this session) registry note that A2MCP payment configuration runs on X Layer.
- Generic x402 verify/settle mechanics (independently fetched from `docs.x402.org` this session): the resource server verifies a payment payload against its own declared requirements — either locally or by delegating to a facilitator's `/verify` and `/settle` endpoints — and re-issues `402` on verification failure. A known Solana-specific pre-confirmation replay race is mitigated by a 120-second `SettlementCache`; X Layer is EVM, so this specific race is unlikely to apply, but Nobu's own idempotency design (§6) does not rely on the payment layer for exactly-once monitor creation regardless.

## 2. Undocumented or blocked capabilities

Not established by any source reachable or supplied this session:

- Whether one registered endpoint may branch **per request** between a free `200` and an x402 `402` (mixed free/paid actions under one URL), or whether "one of two compliant forms" is enforced at the endpoint level.
- Whether one provider may hold **multiple A2MCP listings/endpoints at different prices**.
- Whether ASP `#5541` may change from free to paid while `PENDING_REVIEW`, and what resubmission that would require.
- The exact settlement asset/token for a $0.99 charge on X Layer.
- Whether OKX forwards any stable, verifiable end-user or Agentic Wallet identity (address, verified email, or signed identity assertion) into the ASP's HTTP request. The packaged skill's "log in via email OTP or AK" is the **wallet's own login UX**, not evidence of identity forwarded to third-party ASP servers.
- Whether A2MCP requests carry any cross-call session/authorization mechanism the ASP can rely on, versus the ASP round-tripping its own opaque state in the JSON body/response (which is how Nobu's existing `AgentRequest` schema already works for `purchase_id`).
- Reviewer/listing implications of adding any paid surface near an already-`PENDING_REVIEW` ASP.

None of these are resolved by this lane. They gate Lane 7.4D (§9).

## 3. Identity architecture — selected

**Selected: agent-native short-code email verification, Nobu-issued and Nobu-verified, independent of whatever OKX identity signal may or may not exist.**

This is not an emergency fallback adopted only because OKX proof was unobtainable. Even if a future OKX release supplies a verified identity or email to the ASP, Nobu still needs to independently confirm that the specific mailbox receiving price-drop alerts is one the requesting user actually controls, because:

- price-drop alerts are private, purchase-linked communications — Nobu, not OKX, is accountable for who receives them;
- an OKX-supplied identity (if one ever exists) would attest to *wallet/account* control, not necessarily to *mailbox* control, and Nobu's existing durable auth model (`src/auth/`) is already built around a verified-email account, not a wallet address;
- reusing the existing durable Postgres `AuthStore` (accounts, sessions, purchase blobs) keeps one source of truth for "who owns this purchase and where do alerts go," rather than introducing a second, wallet-keyed identity system that the monitoring/notification stack would need to reconcile against.

So this lane keeps the fallback design mandated by the lane brief, but frames it as the **permanent** Nobu-side control, not a placeholder.

### 3.1 Flow

1. Agent calls `BEGIN_EMAIL_VERIFICATION` with an email address (and optionally a description of the purchase, for UX only — never trusted for matching).
2. Nobu creates a durable, single-use verification challenge, sends a short numeric code to that email, and returns `EMAIL_CODE_SENT` with an opaque `connection_id` (not the code, not a token).
3. The agent relays the code back to the user conversationally; the user reads it from their inbox and tells the agent.
4. Agent calls `VERIFY_EMAIL_CODE` with `connection_id` + the code.
5. Nobu verifies ownership, marks the challenge consumed, and creates (or reuses) a **scoped, revocable agent connection** bound to the verified email/account. Returns `EMAIL_VERIFIED` with the connection's durable `connection_id` for use on later calls.
6. No website visit, browser login, or approval page is required at any point. The existing magic-link web flow (`src/auth/service.ts`) is untouched and remains available for the optional dashboard, but marketplace use never depends on it.

### 3.2 Code properties (all required, matching the lane brief)

- **Short-lived** — expires in 10 minutes (reuses the existing `AUTH_LOGIN_TOKEN_TTL_MS`-style pattern, new constant `AGENT_EMAIL_CODE_TTL_MS`, shorter than the current magic-link TTL because it is user-typed, not clicked).
- **Single-use** — first successful `VERIFY_EMAIL_CODE` consumes it; concurrent/replayed verification attempts lose, matching the existing `markLoginTokenUsed` compare-and-set pattern in `src/auth/auth-store.ts`.
- **Rate-limited** — per-email and per-IP/agent-key buckets, reusing the existing `auth_rate_limits` table pattern (`emailBucket` in `src/auth/service.ts`) plus a new attempt-count cap on `VERIFY_EMAIL_CODE` itself (e.g. 5 wrong codes exhausts the challenge and forces a new `BEGIN_EMAIL_VERIFICATION`).
- **Bound to one connection request and email** — the code hash is stored alongside the target `email_normalized` and the `connection_id` it was issued for; a code cannot verify a different connection or a different email.
- **Stored hashed** — same `sha256Hex` pattern already used for magic-link tokens and sessions (`src/auth/crypto.ts`); the raw code is never persisted, logged, or included in proof bundles.
- **Unusable as a browser login token** — the code has no relationship to `auth_login_tokens` or `auth_sessions`; verifying it creates an `agent_connections` row (§3.3), never a browser `nobu_auth_session_v1` cookie. An agent connection cannot be used to sign into the website, and a website session cannot be used to authorize agent-native monitoring actions.
- **Cannot access purchases by itself** — a verified connection can *create* a new confirmed-product enrollment and *view status for monitors it created*; it does not grant blanket read access to a website account's full purchase history. If the verified email matches an existing Nobu account, the connection is linked to that `acct_*` id for consent/notification purposes (so alerts go through the existing Lane 7.3B pipeline), but the agent conversation only ever sees purchases/monitors it itself created or that it explicitly queries by a monitor ID it already holds.

### 3.3 New durable record — `agent_connections`

```
agent_connections
  id                    TEXT PK   (conn_*)
  account_id            TEXT      -- auth_accounts.id (nullable until first VERIFY_EMAIL_CODE)
  email_normalized       TEXT
  status                TEXT      -- pending_verification | active | revoked | expired
  created_at            TEXT
  verified_at           TEXT NULL
  revoked_at            TEXT NULL
  last_used_at          TEXT NULL
  scope                 TEXT      -- fixed: "agent_native_monitoring_v1"

agent_email_codes
  id                    TEXT PK
  connection_id         TEXT      -- FK agent_connections.id
  email_normalized       TEXT
  code_hash              TEXT      -- sha256Hex(code)
  expires_at             TEXT
  attempt_count           INTEGER  DEFAULT 0
  used_at                TEXT NULL
  created_at              TEXT
```

Both tables live in the same durable Postgres store as `auth_accounts` / `auth_login_tokens` (`src/auth/durable-schema.ts` pattern), not in the per-instance SQLite/browser-cookie snapshot that Lane 7.3A.2A.1R already fixed for exactly this class of bug (see `[[nobu_cookie_snapshot_bug]]` in memory) — an agent connection must be visible from any Vercel instance the next A2MCP call happens to land on.

### 3.4 Revocation

`REVOKE_AGENT_CONNECTION` sets `agent_connections.status = 'revoked'` and `revoked_at`. Revoking a connection:

- immediately blocks that connection from any further `/v1/agent` action requiring an active connection;
- does **not** delete or stop monitors already started (see §6.6 — revocation is not a silent way to erase a paid activation);
- does **not** retroactively invalidate past email verification for audit purposes (the historical `agent_email_codes`/`agent_connections` rows stay, hashed, for the security audit trail).

## 4. Payment architecture — topology deferred, mechanics designed

### 4.1 What is selected now

Nothing about **where** the paid action is registered with OKX is selected in this lane. Per the coordinator-provided findings (§1), an A2MCP endpoint is one fixed price, one of two compliant forms (free-200 or x402-402) — this rules out assuming "just add a paid branch inside the existing free `/v1/agent` endpoint, no listing change needed" as a safe default. That assumption is explicitly **not** adopted.

Two deployment alternatives are documented as internally compatible with the same durable data model (§4.3–§6); the choice between them is deferred to Lane 7.4D's capability re-check (§9):

**Option A — Separate free and paid marketplace services**
- A free orchestration/preflight ASP (or the existing `#5541` unchanged) handles `UNDERSTAND_PURCHASE`, `DISCOVER_PRODUCT`, `CONFIRM_PRODUCT`, `BEGIN_EMAIL_VERIFICATION`, `VERIFY_EMAIL_CODE`, `PREFLIGHT_MONITORING` — all free, all returning `200`.
- A second, separately registered paid ASP (new listing) exposes exactly one x402-gated action — activation — priced at the registered fixed per-call price ($0.99 equivalent).
- Both share the same Nobu account, quote, purchase, scheduler, and notification systems; the paid ASP's activation call simply consumes an `enrollment_quote_id` minted by the free service.

**Option B — One paid marketplace service**
- Free preparation (purchase understanding, discovery, confirmation, email verification, consent, eligibility preflight) happens through the existing free `#5541` A2MCP listing (unchanged) and/or the web product.
- A single new paid ASP listing exposes one action: given an already-preflighted `enrollment_quote_id`, pay once and activate. The paid ASP does no discovery/matching work itself — it only validates the quote, gates on payment, and starts monitoring.

Both options keep the **free steps free** (as the lane brief requires: "Product understanding, discovery, confirmation, email verification, consent and eligibility preflight should remain free") by construction — the only thing behind x402 in either option is the single activation call, because OKX's per-endpoint fixed-price model makes a granular per-action price list impossible to express as one listing regardless of which option is chosen.

Neither option requires converting `#5541` to paid, and neither is selected as final. Lane 7.4D decides between them once the Unknown items in §2 are resolved.

### 4.2 Rejected alternative

- **"Mixed free and paid actions under the existing free `/v1/agent` endpoint, no new listing."** Generic x402/MCP precedent (Cloudflare's `paidTool`, `CF-X402-MCP-TOOLS`) shows this is a valid pattern for x402-over-MCP in general, but the coordinator-provided OKX-specific findings describe registration as one fixed price per endpoint with the endpoint being one of two compliant forms — not a per-request-branching hybrid. Adopting the generic MCP precedent over the OKX-specific registration model would risk building against a shape OKX's marketplace doesn't actually support. Rejected for this lane; may be revisited only if Lane 7.4D's capability re-check finds explicit OKX confirmation that per-request branching under one listing is supported.

### 4.3 Durable records (topology-independent)

These records are shared by both Option A and Option B and do not change based on which is picked:

```
monitoring_enrollment_quotes
  id                      TEXT PK   (quote_*)
  connection_id            TEXT      -- agent_connections.id
  account_id               TEXT      -- resolved account (agent_connections.account_id)
  purchase_id               TEXT      -- confirmed purchase row
  fingerprint_id             TEXT      -- locked product fingerprint (matching.confirm output)
  price_amount               NUMERIC   -- 0.99
  price_currency              TEXT      -- "USD" (display) 
  settlement_asset            TEXT NULL -- resolved at 7.4D once §2's asset Unknown is closed
  settlement_network           TEXT NULL -- resolved at 7.4D ("X Layer" expected, chain 196)
  monitoring_deadline           TEXT      -- copied from the Target policy window at quote time
  consent_monitoring_at          TEXT NULL
  consent_email_alerts_at         TEXT NULL
  idempotency_key                  TEXT UNIQUE  -- caller-independent hash: purchase_id + fingerprint_id + connection_id
  status                           TEXT      -- issued | expired | consumed | superseded
  expires_at                       TEXT      -- short TTL (e.g. 15 minutes) — a stale quote fails closed, not silently re-priced
  created_at                       TEXT

payment_attempts
  id                       TEXT PK   (pay_*)
  quote_id                  TEXT      -- FK monitoring_enrollment_quotes.id
  x402_challenge_ref          TEXT      -- opaque reference to the issued 402 challenge (not the raw payload)
  status                       TEXT      -- challenged | verifying | settled | failed | expired
  settlement_ref                TEXT NULL -- facilitator/tx reference once settled
  created_at                     TEXT
  settled_at                      TEXT NULL

monitor_activations
  id                        TEXT PK   (act_*)
  quote_id                   TEXT UNIQUE -- FK; UNIQUE enforces exactly-one activation per quote
  payment_attempt_id           TEXT      -- FK payment_attempts.id (the one that settled)
  purchase_id                   TEXT      -- FK purchases.id
  monitor_id                     TEXT      -- the purchase_id already IS Nobu's monitor id (reuse, no new id space)
  created_at                      TEXT
```

`monitoring_enrollment_quotes` and `payment_attempts` are new; `monitor_activations` is a thin ledger row that reuses the existing `purchases` table as the actual monitor record (§6.5 explains why no parallel "monitor" entity is introduced).

## 5. Deterministic boundaries (unchanged from existing AI boundary, extended)

The AI boundary already in `AGENTS.md` and `docs/nobu-privacy-security-threat-model.md` extends unchanged to the agent-native flow:

- The agent may parse, explain, and relay codes/prompts, but never chooses the confirmed product (`CONFIRM_PRODUCT` requires the user to pick a specific `candidate_id` from server-returned candidates — the same reload-and-revalidate pattern already implemented in `src/matching/confirm.ts` for the web flow, reused verbatim, not reimplemented).
- The agent cannot start monitoring without both `CONFIRM_PRODUCT` having locked a fingerprint **and** explicit `CONSENT_REQUIRED` responses having been satisfied (monitoring consent + email-alert consent, both durable timestamps — the existing `purchase_email_alert_prefs` / `email_alerts_consent_at` pattern from Lane 7.3B, extended to also cover the base monitoring consent that today is implicit in "user clicked Find my product").
- `START_MONITORING` (or the paid-ASP equivalent action in whichever topology Lane 7.4D selects) only succeeds against a `monitoring_enrollment_quotes` row that is `issued`, unexpired, and whose `idempotency_key` has not already produced a `monitor_activations` row — payment verification is necessary but never sufficient; a settled payment against an expired or already-consumed quote still fails closed (§6.4).
- Monitoring activation requires, all together: verified identity/email (§3), exact user-confirmed Target product with a locked fingerprint (existing `src/matching`), supported Target.com/app purchase + Target seller + Target Plus exclusion (existing `src/policy`), an active monitoring window (existing policy engine), monitoring consent, email-alert consent, and verified `$0.99` settlement. Any single missing item fails closed with the matching status from §7 — never a partial activation.

## 6. Payment ⇄ monitoring interaction rules

### 6.1 Free steps never touch payment

`UNDERSTAND_PURCHASE`, `DISCOVER_PRODUCT`, `CONFIRM_PRODUCT`, `BEGIN_EMAIL_VERIFICATION`, `VERIFY_EMAIL_CODE`, `PREFLIGHT_MONITORING`, `CHECK_MONITORING_STATUS`, `LIST_ACTIVE_MONITORS`, `ENABLE_EMAIL_ALERTS`, `DISABLE_EMAIL_ALERTS`, `STOP_MONITORING`, `REVOKE_AGENT_CONNECTION` never create a `payment_attempts` row and never appear behind a 402, in either Option A or Option B. Only the single activation action does.

### 6.2 `PREFLIGHT_MONITORING` is the free/paid boundary

`PREFLIGHT_MONITORING` runs the full deterministic eligibility check (§5) against a confirmed purchase and, only if every condition already passes, mints a `monitoring_enrollment_quotes` row and returns `PAYMENT_REQUIRED` with the quote id and price. If any condition fails, it returns the specific failure status (`UNSUPPORTED_PURCHASE`, `MATCH_REVIEW_REQUIRED`, `CONSENT_REQUIRED`, `EMAIL_VERIFICATION_REQUIRED`, etc. — §7) and **no quote is minted**. This guarantees unsupported purchases never reach payment, per the lane's hard requirement.

### 6.3 First valid paid replay creates exactly one monitor

Activation is a single idempotent operation keyed on `monitoring_enrollment_quotes.idempotency_key`:

1. Payment settles (verified via whichever x402 verify/settle path Option A/B uses).
2. The activation handler does, inside one durable transaction: re-validate the quote is `issued` and unexpired → mark it `consumed` → insert one `monitor_activations` row (`quote_id` is `UNIQUE`, so a second concurrent attempt on the same quote fails the insert, not creates a duplicate) → flip the underlying `purchases.status` to `MONITORING_ACTIVE` using the existing monitoring-start code path (`src/monitoring`), unchanged.
3. Any replay of the same settled payment (duplicate webhook, retried client, re-sent `X-PAYMENT`) that reaches the activation handler again finds the quote already `consumed` and returns `ALREADY_ACTIVE` with the existing `monitor_id`, never a second `purchases` row and never a second `monitor_activations` row.

### 6.4 Altered or expired quote fails closed

If the `idempotency_key`, `purchase_id`, `fingerprint_id`, or price on the incoming activation request don't match the stored quote exactly, or the quote's `expires_at` has passed, activation fails with `CONNECTION_EXPIRED` (or a dedicated `QUOTE_EXPIRED` — see §7 note) and does **not** fall back to re-deriving eligibility on the fly. The caller must re-run `PREFLIGHT_MONITORING` to mint a fresh quote. Payment already collected against an expired quote is never silently reused for a re-priced or re-matched purchase — that would let payment override eligibility, which is explicitly forbidden.

### 6.5 No parallel monitor entity

`monitor_id` in every proposed response is the existing `purchases.id` — the same identifier the current `CHECK_MONITORING_STATUS` action already returns as `purchase_id`. This lane does not introduce a second "monitor" table or id space; `monitor_activations` is a payment-ledger fact ("this purchase's monitoring was activated via this payment"), not a competing source of truth for monitoring state. `src/monitoring/scheduler.ts`, `src/monitoring/store.ts`, and the Lane 7.3B notification pipeline (`src/notifications/`) are reused unmodified — an agent-originated paid monitor is, from the scheduler's perspective, just another `MONITORING_ACTIVE` row with `fingerprint_id` set, exactly like a web-originated one.

### 6.6 Revocation, stop, and refunds do not retroactively erase paid state

- `REVOKE_AGENT_CONNECTION` (§3.4) never touches `monitor_activations` or `purchases` rows; it only blocks the connection from further agent-native calls.
- `STOP_MONITORING` sets the purchase to a stopped/archived state (reusing the existing Lane 7.3A.2B archive lifecycle) but the `monitor_activations`/`payment_attempts` audit trail is retained — stopping monitoring is a lifecycle action on the purchase, not a ledger deletion.
- No response body, email, or status message issued by any of these actions promises or implies a refund. `STOP_MONITORING`'s response text is reviewed against the existing locked-language list in `docs/nobu-clean-master-spec.md` §9 before implementation.

### 6.7 Temporary persistence failure must not cause double payment

The activation transaction in §6.3 is structured so that the `purchases.status` flip happens **after** the `monitor_activations` insert succeeds, inside the same durable-store transaction where possible (Postgres `AuthStore`/durable DB), so a crash between "payment settled" and "monitor started" leaves the quote `consumed` with no activation row, in which case a retry of the *same* settled-payment replay is safe (§6.3 step 3 still applies once the row exists) — but a crash that leaves the quote still `issued` with a payment that already settled is the one edge case requiring a reconciliation job (out of scope for this lane; flagged for Lane 7.4D as an explicit build item, not silently assumed away).

## 7. Proposed action contract and statuses

All actions below are **proposed**, additive to the existing three live actions, and namespaced the same way (`action` field in the `POST /v1/agent` body, or the paid-topology equivalent per whichever of Option A/B Lane 7.4D selects). None are implemented by this lane.

| Action | Free/Paid | Purpose |
|---|---|---|
| `UNDERSTAND_PURCHASE` | free (live today) | unchanged |
| `DISCOVER_PRODUCT` | free (proposed) | agent-native equivalent of the existing web candidate-discovery flow (`src/matching/discovery-candidates.ts`), returning bounded Target candidates |
| `CONFIRM_PRODUCT` | free (proposed) | agent-native equivalent of `src/matching/confirm.ts` — locks a fingerprint from a server-held candidate id, never client-asserted product data |
| `BEGIN_EMAIL_VERIFICATION` | free (proposed) | §3.1 step 1–2 |
| `VERIFY_EMAIL_CODE` | free (proposed) | §3.1 step 4–5 |
| `PREFLIGHT_MONITORING` | free (proposed) | §6.2 — the free/paid boundary; mints a quote only on full eligibility pass |
| `START_MONITORING` | **paid** (proposed) | §6.3 — consumes a settled payment against a quote; exactly-once |
| `CHECK_MONITORING_STATUS` | free (live today) | unchanged |
| `LIST_ACTIVE_MONITORS` | free (proposed) | owner-scoped list, reusing existing owner-scope rules from `src/web/session-owner.ts` |
| `ENABLE_EMAIL_ALERTS` / `DISABLE_EMAIL_ALERTS` | free (proposed) | agent-native equivalent of the existing `src/notifications/prefs.ts` toggle |
| `STOP_MONITORING` | free (proposed) | §6.6 |
| `REVOKE_AGENT_CONNECTION` | free (proposed) | §3.4 |

### Continuation statuses (proposed, additive to the existing `A2mcpStatus`/agent response vocabulary)

| Status | Meaning |
|---|---|
| `MORE_INFORMATION_REQUIRED` | purchase intake incomplete; mirrors existing `UNDERSTAND_PURCHASE` behavior |
| `PRODUCT_CONFIRMATION_REQUIRED` | candidates returned, awaiting explicit `CONFIRM_PRODUCT` |
| `EMAIL_VERIFICATION_REQUIRED` | no active `agent_connections` row for this conversation |
| `EMAIL_CODE_SENT` | `BEGIN_EMAIL_VERIFICATION` succeeded; awaiting `VERIFY_EMAIL_CODE` |
| `EMAIL_VERIFIED` | connection active |
| `CONSENT_REQUIRED` | monitoring and/or email-alert consent not yet given |
| `PAYMENT_REQUIRED` | `PREFLIGHT_MONITORING` passed; quote minted, awaiting payment |
| `PAYMENT_PENDING` | payment challenged/verifying, not yet settled |
| `MONITORING_STARTED` | first successful activation for this quote |
| `MONITORING_ACTIVE` | existing status, unchanged |
| `PRICE_DROP_DETECTED` | existing status, unchanged |
| `ALREADY_ACTIVE` | replayed activation against an already-consumed quote (§6.3) |
| `ACTION_NOT_AUTHORIZED` | connection revoked/expired, or action targets a purchase the connection does not own |
| `CONNECTION_EXPIRED` | connection or quote expired (§6.4) — implementers may split this into `CONNECTION_EXPIRED` vs a dedicated `QUOTE_EXPIRED` at 7.4D build time; both fail closed identically |
| `UNSUPPORTED_PURCHASE` | existing status, unchanged |

## 8. Reused vs new components

**Reused unmodified:** `src/matching/*` (discovery, confirm, evaluate), `src/policy/*` (Target eligibility, window calc), `src/monitoring/*` (scheduler, budget, runner, selection, store), `src/notifications/*` (prefs, ledger, process, email-send — Lane 7.3B's consent + idempotency + anti-spam machinery), `src/auth/auth-store.ts`'s durable-Postgres pattern (new tables added to the same store, not a new database).

**New:** `agent_connections`, `agent_email_codes`, `monitoring_enrollment_quotes`, `payment_attempts`, `monitor_activations` tables; the twelve proposed actions in §7; the identity flow in §3; the topology-independent payment mechanics in §4.3 and §6.

**Explicitly not built in parallel:** no second scheduler, no second notification system, no second "monitor" entity, no second purchase-ownership model. "Ongoing monitoring through OKX" means enrollment/confirmation/payment/consent/management happen through the agent conversation, but Nobu's existing protected server scheduler performs all later checks and the existing Lane 7.3B email pipeline sends all alerts — the user never needs to keep the agent conversation open, exactly as the lane brief requires.

## 9. Build order adopted

- **Lane 7.4A — Research and architecture.** This document. Complete on PASS.
- **Lane 7.4B — Agent connection and conversational email verification.** Implements §3 (`agent_connections`, `agent_email_codes`, `BEGIN_EMAIL_VERIFICATION`, `VERIFY_EMAIL_CODE`, `REVOKE_AGENT_CONNECTION`). Does not require the payment topology decision — proceeds regardless of §4's open items.
- **Lane 7.4C — Free agent-native purchase preflight.** Implements `DISCOVER_PRODUCT`, `CONFIRM_PRODUCT`, consent capture, `PREFLIGHT_MONITORING`, and `monitoring_enrollment_quotes` issuance (§4.3, §6.2). Also does not require the payment topology decision — a quote can be minted and displayed without yet knowing which ASP topology will consume it.
- **Lane 7.4D — `$0.99` x402 monitoring activation.** **Opens with "OKX paid-service topology capability re-check"** before any payment code is written, specifically to resolve: (a) whether one endpoint may branch free/paid per request, (b) whether multiple listings/prices are supported, (c) whether `#5541` may become paid while under review or a new listing is required, (d) the settlement asset/network for X Layer. **If any of (a)–(d) remain unresolved after that re-check, Lane 7.4D returns `NOBU_LANE_7_4D_BLOCKED`** rather than guessing a topology. Once resolved, implements whichever of Option A/Option B (§4.1) the findings support, plus `payment_attempts`, `monitor_activations`, `START_MONITORING`, and the exactly-once/idempotency/fail-closed behavior in §6.
- **Lane 7.4E — Agent-native monitor management.** `CHECK_MONITORING_STATUS` (already live) extended, `LIST_ACTIVE_MONITORS`, `ENABLE_EMAIL_ALERTS`/`DISABLE_EMAIL_ALERTS`, `STOP_MONITORING`.
- **Lane 7.4F — Scheduler and notification integration.** Proves agent-originated paid monitors flow through the existing scheduler/notification stack unmodified (§8) — expected to be mostly proof work, since no parallel implementation was built.
- **Lane 7.4G — Live marketplace end-to-end proof.** `agent request → product confirmation → email verification → consent → genuine $0.99 payment → monitor activation → scheduled monitoring → genuine eligible email alert → status retrieval → duplicate suppression`.
- **Return to Lane 8 — reviewer-status monitoring** after the applicable 7.4 proof, per the existing build order.

## 10. Hard locks carried forward unchanged

Target.com/app only; Target seller only; Target Plus excluded; SerpApi remains third-party observed data; no direct Target scraping; no Target account login; no claim submission; no payment-card/password/2FA/wallet-key collection; no guaranteed-refund language; fail closed on ambiguity; no fake payments/users/revenue/transactions/alerts; ASP #5541 remains unchanged by this lane.
