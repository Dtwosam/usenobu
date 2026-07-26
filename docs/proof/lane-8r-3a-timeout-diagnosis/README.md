# Lane 8R.3A — Diagnose OKX A2MCP review timeout

**Status:** `NOBU_LANE_8R_3A_PASS`
**Date:** 2026-07-26
**Type:** Diagnosis only. No code change, no deployment, no ASP `#5541` update, no activation, no resubmission, no genuine payment.

**Base commit note.** The lane brief named `353c7a4` as the base. The working tree is at `27f53cf` ("Repair Nobu OKX review mismatch"), which is a direct descendant of `353c7a4` and is the commit whose deployment (`dpl_AUMLVaTCynKxqPL5HMMBT5ERsq6b`, 2026-07-23) OKX actually reviewed. The diagnosis was therefore run against `27f53cf`; running it against `353c7a4` would have described a build OKX never tested.

---

## 0. What OKX reported

`agent get-agents --agent-ids 5541` (official Onchain OS CLI v4.2.4, read-only) returns:

| Field | Value |
|---|---|
| `approvalDisplayStatus` | `5` |
| `approvalLabel` | `Listing rejected` |
| `statusLabel` | `not listed` |
| `approvalStatus` (service-list view) | `6` |

Exact `approvalRemark`:

> During platform testing, we were unable to receive a response from your Agent, causing the task to time out and be stopped.
>
> Please follow these steps to troubleshoot and resolve the issue:
> 1. Quick debug: Give the following developer docs to your Agent so it can scan for potential issues in the code: A2A: https://web3.okx.com/onchainos/dev-docs/okxai/how-to-become-a2a, A2MCP: https://web3.okx.com/onchainos/dev-docs/okxai/howtomcp, and allow your Agent to make changes based on these docs.
> 2. Manual testing: Register as an OKX.ai user, then try using your Agent by prompting "I would like to use the services of agent ID {enter your agent ID}" — check whether your Agent responds normally to the user's message. If it doesn't respond, use AI to help diagnose why your Agent's service isn't responding, and make the necessary deployment and code changes.
>
> Once you've completed your checks and made the necessary changes, please resubmit for review via chat.

Evidence: `okx-readonly/asp-5541-state-redacted.json`.

---

## 1. Official A2MCP contract audit

### 1.0 Authority availability — read this first

**The nominated authority `https://web3.okx.com/onchainos/dev-docs/okxai/howtomcp` could not be read from this environment.**

| Check | Result |
|---|---|
| Local DNS `web3.okx.com` / `www.okx.com` | `DNS_FAIL` |
| Local DNS `okx.ai`, `api.groq.com`, `usenobu.vercel.app`, `serpapi.com` | resolved |
| DNS-over-HTTPS (`dns.google`) for `web3.okx.com` | resolves to Cloudflare edge (2 A records) |
| `curl --resolve web3.okx.com:443:<edge-ip>` (both A records) | `curl: (7) Failed to connect` — TCP blocked, not a DNS artifact |
| Control host `https://www.cloudflare.com/robots.txt` | `200` |
| `https://www.okx.ai/onchainos/dev-docs/okxai/howtomcp` | `404` (not mirrored) |

This matches the standing repo record (Lane 7.4A.1, 7.4D.0): `web3.okx.com` / `www.okx.com` are unreachable from this environment. **No synthesis, search result, or memory was substituted for the doc.** Items that only that doc can settle are marked `UNRESOLVED_FROM_DOCS`.

Official OKX sources that *were* reachable and used instead:

- `github.com/okx/onchainos-skills` → `skills/okx-ai/references/identity-register.md` (registration field rules).
- The official Onchain OS CLI **v4.2.4** installed in this environment — `agent x402-check`, `agent service-list`, `agent get-agents`, `agent designated-route`, `agent search`, `agent system-config`, `agent active-tasks`, `agent task-in-progress`. All read-only; no state-changing command was run.
- The OKX backend itself, via those read-only CLI calls.

### 1.1 Audit table

| # | Contract item | Verdict | Evidence |
|---|---|---|---|
| 1 | Service registration and required inputs | `COMPLIANT` | Both services registered as `serviceType: A2MCP` with a 5–30 char name distinct from the agent name, a description under 500 chars, a public `https://` endpoint under 512 chars, and a digits-only fee (`0`, `0.99`). Backend accepted both. `okx-readonly/services-33561-35958.json` |
| 2 | HTTP method | `MISMATCH` | The official validator `agent x402-check` with no `--body` issues a **GET**; both endpoints answer **405** with an empty body and no `Content-Type`. Correlated in the Vercel request log (`GET /v1/agent/start-monitoring → 405` at 01:07:15Z ↔ CLI audit `agent x402-check` at 02:07:16 local/+1). `okx-readonly/x402-check-official.json`, `vercel/request-log-correlation.json` |
| 3 | Content type | `COMPLIANT` | `application/json`, `text/plain`, and a request with no `Content-Type` header all reach the handler identically; `application/x-www-form-urlencoded` fails only because the body is not JSON. Content type is not a gate. `request-matrix/method-and-content-type-probes.json` |
| 4 | Free-service responses | `MISMATCH` | The free service answers `200` **only** to a request already shaped as `{"action":"<ENUM>", …}`. A bare `{}`, a natural-language `{"query":…}` / `{"message":…}` / `{"prompt":…}` envelope, an MCP `initialize`, an MCP `tools/list`, and an A2A `message/send` all return `400`. A `GET` returns `405`. `request-matrix/matrix-results.json`, `request-matrix/mcp-a2a-protocol-probes.json` |
| 5 | Paid `402` responses and required headers | `MISMATCH` | The **official** OKX validator rejects the paid service twice: no body → `Endpoint returned HTTP 405 (not 402); not a valid x402 service` (`valid:false`); `--body '{}'` → `Endpoint returned HTTP 400 (not 402); not a valid x402 service` (`valid:false`). No `PAYMENT-REQUIRED` header is emitted on any first-contact probe. The service only emits its (contract-correct) `402` after a valid `quote_id` + `connection_id` + `connection_token`. `okx-readonly/x402-check-official.json` |
| 6 | Endpoint accessibility | `COMPLIANT` | Both endpoints resolve publicly over HTTPS with valid TLS, `Server: Vercel`, `Strict-Transport-Security` set, **zero redirects**, no access protection / no auth wall, `X-Matched-Path` equal to the registered path, and `X-Vercel-Cache: MISS` (not a stale cached answer). `GET /health` → `200`. Every probe in this lane returned in under 10 s. |
| 7 | Response format and parseability | `COMPLIANT` for POST-with-JSON-action; `MISMATCH` otherwise | Every `POST` answer is `application/json` and parses. Every `GET`/`HEAD` answer is `405` with an **empty body and no `Content-Type`** — a caller that probes with `GET` gets nothing machine-readable at all. |
| 8 | Documented latency / timeout requirements | `UNRESOLVED_FROM_DOCS` | No latency or timeout figure appears in any official source reachable from here. `identity-register.md` states none. The OKX task window that expired is not published in any source read. |
| 9 | Discovery document requirement | `UNRESOLVED_FROM_DOCS` (behaviourally `MISMATCH`) | `/.well-known/agent-card.json`, `/.well-known/agent.json`, `/.well-known/ai-plugin.json`, `/.well-known/mcp.json`, `/.well-known/oauth-protected-resource`, `/.well-known/oauth-protected-resource/v1/agent` → all `404`. Whether OKX *requires* any of these is exactly what the unreachable doc would settle; that an OKX-side caller *asked for two of them* is proven below (§4.2). |

---

## 2. Read-only ASP and Production inspection

### 2.1 ASP `#5541`

| Field | Value |
|---|---|
| Agent ID | `#5541` |
| Name | Nobu |
| Role | ASP |
| Status | not listed |
| Approval | `5` — Listing rejected (reason quoted in §0) |
| Chain index | `196` (X Layer) |
| Category | `SOFTWARE_SERVICES` |
| `onlineStatus` | `1` |
| Created | 2026-07-14 |
| Updated | 2026-07-26 |

Agent description (verbatim):

> Nobu is an AI post-purchase monitoring agent. It confirms the exact product, monitors eligible Target purchases, and alerts users when a safely matched lower price may create an opportunity to request the difference from the retailer. Users can set up and manage monitoring through an AI-agent conversation. Target is currently the only supported retailer; Target verifies eligibility and makes the final decision.

Wallet, owner and communication addresses are masked in the stored evidence.

### 2.2 Services

| | Service `33561` | Service `35958` |
|---|---|---|
| Name | Nobu Purchase Setup | Nobu Monitoring Activation |
| Type | A2MCP | A2MCP |
| Fee | `0` USDT | `0.99` USDT |
| Endpoint | `https://usenobu.vercel.app/v1/agent` | `https://usenobu.vercel.app/v1/agent/start-monitoring` |
| Free trial | none | none |
| Subscriptions | none | none |

Descriptions (verbatim):

- **33561** — *"Free agent setup for Target post-purchase monitoring: discover and confirm products, verify email, capture consent, check eligibility, prepare quotes, list/status, alert prefs, stop, and revoke. Does not activate paid monitoring.\nUser provides: 1. purchase details 2. exact product confirmation 3. verified email 4. monitoring and email-alert consent."*
- **35958** — *"Activates scheduled monitoring for one confirmed eligible purchase after verified $0.99 OKX payment. Payment does not guarantee a lower price, alert, refund, adjustment, or savings.\nUser provides: 1. verified connection 2. valid enrollment quote 3. completed OKX payment for activation."*

### 2.3 Description clarity assessment

| Question | `33561` | `35958` |
|---|---|---|
| States what the service does | **Yes** | **Yes** |
| States exact required inputs | **No** — lists four *business* inputs but never the wire contract: no `action` value, no field names, no example request | **No** — names three prerequisites but not `quote_id` / `connection_id` / `connection_token`, and does not say the payment travels in a header |
| States whether earlier Nobu steps are required | **Yes**, implicitly ("Does not activate paid monitoring" marks it as the first step) | **Partly** — "verified connection" and "valid enrollment quote" imply a predecessor but never name the free service or the actions that mint them |
| States expected result or next step | **Partly** — enumerates capabilities, not an outcome | **Yes** — "Activates scheduled monitoring for one confirmed eligible purchase" |

**Consequence:** a caller that reads only the listing cannot construct a single valid request to either service. For contrast, an approved and publicly listed A2MCP peer (`#2013`) writes every service description in a `summary: / feature list: / example prompts:` form that names the call and gives a prompt that works — `okx-readonly/reference-listed-asp-description-format.json`. Nothing was copied from it; it is recorded only as a format reference.

### 2.4 Endpoint confirmation

| Check | `/v1/agent` | `/v1/agent/start-monitoring` |
|---|---|---|
| Public HTTPS | yes | yes |
| Redirects | none | none |
| Access protection | none | none |
| `X-Matched-Path` | `/v1/agent` | `/v1/agent/start-monitoring` |
| Serves intended Production deployment | yes | yes |
| Bounded error response | yes (JSON `400`/`401`/`429`) | yes (JSON `400`/`401`) |
| Health | `GET /health` → `200`; `GET /v1/agent/health` → `404` | same host |

Production routing confirmed: `usenobu.vercel.app` → `usenobu-9bt7yc5t2-…` → `dpl_AUMLVaTCynKxqPL5HMMBT5ERsq6b` (Production, Ready, created 2026-07-23), the deployment built from the reviewed commit. `vercel/production-deployment-identity.md`.

---

## 3. Exact OKX.ai User test

**The literal test was not run, and here is the exact restriction.**

1. `#5541` is `approvalDisplayStatus 5` / `statusLabel "not listed"`. It is **absent from public marketplace search**: `agent search --query "Nobu"` returned 10 agents, none of them `5541`; `agent search --query "Target price monitoring post-purchase"` returned 11 agents, none of them `5541`. A rejected agent is not discoverable by an OKX.ai User through normal search.
2. This account owns **no User-role agent** — `agent my-agents` returns exactly one agent, `#5541`, role ASP. Registering a User-role identity is a new on-chain registration, which is outside a diagnosis-only lane and outside the "existing ASP `#5541` only" lock. It was not performed.

**Official preview/test path used instead.** `agent designated-route --provider 5541` is the exact call an OKX.ai User session makes to route to a provider named by agent ID — the path the reviewer's prompt ("agent ID 5541") drives. It resolves even while the listing is rejected:

| Recorded item | Result |
|---|---|
| Nobu discovered | **Not by search.** Resolvable by explicit agent ID only |
| Which service OKX selects | Routing returns the provider with a **default top-level endpoint of the free service** `/v1/agent` and `feeAmount: "0"`, while declaring `route: "x402"` for the provider; both services are listed |
| Whether OKX asks for inputs | Not reached — routing returns service metadata only |
| Whether a request reaches Nobu | **Yes** — see §4.2. `x402-check` calls landed on production and are correlated in the Vercel log |
| Visible response, error or timeout | `x402-check` → `valid: false` for **both** services (`405` no-body, `400` with `{}`) |
| Total duration | `designated-route` 1.3 s / 2.2 s; `x402-check` 0.9–1.5 s; every underlying HTTP hop under 2.2 s |

No paid activation was attempted. `okx-readonly/marketplace-discoverability.json`, `okx-readonly/designated-route-5541.json`, `okx-readonly/x402-check-official.json`.

---

## 4. Correlation with Vercel logs

### 4.1 The review window is gone

| Query | Records |
|---|---|
| `vercel logs --environment production --since 72h --limit 200 --json` | 49, spanning **00:37:37Z – 01:20:16Z on 2026-07-26 only** (~43 minutes) |
| `--since 2026-07-25T00:00:00Z --until 2026-07-26T00:00:00Z` | **0** |
| `--since 2026-07-23T00:00:00Z --until 2026-07-26T00:00:00Z` | **0** |

Request-log retention on this project is well under an hour. **Nothing from the OKX review window (on or before 2026-07-25T15:00Z, when the rejection notice was sent) is retrievable.** Every record returned was generated by this diagnosis, except the burst below.

Per-record fields available: `timestamp`, `domain`, `requestPath`, `requestMethod`, `responseStatusCode`, `deploymentId`, `environment`, `source`, `level`, `cache`. Fields **not** available: duration, request content type, content length, body key names, recognised `action`, client disconnect, client IP, user agent.

### 4.2 One unattributed external probe burst — the most important log evidence

Between **2026-07-26T00:37:37.912Z and 00:37:40.441Z**, `usenobu.vercel.app` received, in one 2.5-second burst:

| Method | Path | Status |
|---|---|---|
| `GET` | `/v1/agent` | `405` |
| `HEAD` | `/v1/agent` | `405` |
| `POST` | `/v1/agent` | `400` |
| `GET` | `/.well-known/oauth-protected-resource` | `404` |
| `GET` | `/.well-known/oauth-protected-resource/v1/agent` | `404` |
| `GET` | `/.well-known/agent-card.json` | `404` |

That is a textbook **MCP / A2A client discovery handshake**: an MCP Streamable-HTTP client opens the SSE stream with `GET`, posts JSON-RPC `initialize`, and on failure fetches MCP authorization metadata (`/.well-known/oauth-protected-resource`, including the RFC-9728 path-insertion form); the A2A agent card is the A2A equivalent.

**It was not produced by this diagnosis.** The first local probe of this session reached production at **01:07:15Z**, 30 minutes later, and the Onchain OS CLI audit log records no call at all between 00:43:03 and 01:42:57 (local +1). **Attribution to OKX is `NOT_PROVEN`** — Vercel's request-log records carry no client IP or user agent — but the shape is unambiguous, and every single step of that handshake failed.

### 4.3 The A2A / task channel

The rejection names A2A first and says a *task* timed out, so the A2A channel was inspected read-only (`okx-readonly/a2a-channel-state.json`, metadata only — no message content, addresses, or identifiers recorded):

- **Marketplace tasks against `#5541`: `0`**, including terminal statuses (`agent active-tasks --include-terminal`, `agent task-in-progress --agent-ids 5541`). No provider task, no buyer task, ever.
- **Pending XMTP task requests: `0`**. **Agent-to-agent chat sessions ever created: `0`** — the only session is `system-notification`.
- **Every inbound XMTP message ever received (3, all from the official OKX system account) was routed to the local `backup` bucket with `routeReason: invalid-json`** — none was dispatched to an AI runtime, none was answered. Sent 2026-07-17, 2026-07-23, and **2026-07-25T15:00:42Z** (the last matching the rejection timing).
- Delivery lag on the first two was **3 h 04 m** and **1 h 53 m** — the daemon was not running when they were sent.
- The daemon has **no OS autostart** installed; the current process started 2026-07-23T12:10:26Z and depends on this laptop staying awake. At registration the official A2A doctor recorded `ready: false` (`docs/proof/okx/gate4-a2a-doctor-redacted.json`, 2026-07-14).
- `onlineStatus: 1` is produced solely by a 60-second heartbeat from that local daemon. **It advertises availability that nothing behind it can honour.**

### 4.4 Observability gap and the minimum safe instrumentation for 8R.3B

Gaps, exactly:

1. Request-log retention under one hour — no forensic window for any future review.
2. `auditA2mcp(...)` writes to `console`, and those lines are not surfaced in the request-log record, so the route's own `outcome` / `duration_ms` are invisible after the fact.
3. Nothing records **request method, content type, content length, or top-level body key names** — the four facts needed to tell "OKX sent a shape we reject" from "OKX never arrived".
4. Non-`POST` requests (`GET`, `HEAD`) and `404`s on `/.well-known/*` bypass the route handler entirely and are never audited.
5. No client-disconnect signal is captured anywhere.

Minimum safe instrumentation to add **in the repair lane** (do not implement here): on `/v1/agent` and `/v1/agent/start-monitoring`, emit one structured log line per request carrying only `method`, `content_type`, `content_length`, **sorted top-level key names only**, recognised `action` (or `null`), `http_status`, `duration_ms`, and a client-disconnect flag from `req.signal` — plus a catch-all for non-`POST` methods. Never values, headers, emails, tokens, or addresses. Pair it with a log drain or an increased retention setting so a future review window survives.

---

## 5. Reviewer-facing request matrix (production, with timing)

All requests to production `https://usenobu.vercel.app`. Every response was `application/json` and parsed cleanly; every response arrived well inside 10 s. `request-matrix/matrix-results.json`.

### Free service `33561` — `POST /v1/agent`

| # | Case | Status | Duration | JSON | Safe response keys | Clear next step | ≤10 s |
|---|---|---|---|---|---|---|---|
| 1 | no body | `400` | 1.91 s | yes | `error` | **no** | yes |
| 2 | invalid JSON | `400` | 0.73 s | yes | `error` | **no** | yes |
| 3 | `{}` | `400` | 0.77 s | yes | `error`, `message`, `details` | partial — Zod discriminator dump, not guidance | yes |
| 4 | generic natural-language JSON | `400` | 0.64 s | yes | `error`, `message`, `details` | partial | yes |
| 5 | `message` envelope | `400` | 0.53 s | yes | `error`, `message`, `details` | partial | yes |
| 6 | `prompt` envelope | `400` | 0.64 s | yes | `error`, `message`, `details` | partial | yes |
| 7 | valid deterministic action (`CHECK_CONFIRMED_PURCHASE`) | `200` | **8.62 s** first call; 0.62–0.69 s on four repeats | yes | `status`, `policy_id`, `price_source_type`, `final_decision_by`, `checked_at`, `purchase_price`, `currency`, `days_remaining`, `provider`, `official_next_action`, `disclaimer`, `policy_version`, `policy_verified_at`, `policy_review_state`, `policy_warning`, `eligibility_suppressed` | yes | yes (margin 1.4 s on first call) |
| 8 | valid `UNDERSTAND_PURCHASE` | `200` | 1.92 s (repeats 1.91–2.37 s) | yes | `agent_state`, `message`, `requires_user_action`, `next_action`, `extracted_purchase`, `missing_fields`, `uncertain_fields`, `field_evidence`, `provider` | yes | yes |
| 9 | valid `DISCOVER_PRODUCT` | `200` | 2.51 s | yes | `agent_state`, `status`, `discovery_session_id`, `discovery_session_expires_at`, `candidates` | yes | yes |

`PAYMENT-REQUIRED` is not applicable to the free service and was correctly absent on all nine.

### Paid service `35958` — `POST /v1/agent/start-monitoring`

| # | Case | Status | Duration | JSON | Safe response keys | Clear next step | `PAYMENT-REQUIRED` | ≤10 s |
|---|---|---|---|---|---|---|---|---|
| 10 | no body | `400` | 0.80 s | yes | `error` | **no** | absent | yes |
| 11 | invalid JSON | `400` | 0.64 s | yes | `error` | **no** | absent | yes |
| 12 | `{}` | `400` | 0.76 s | yes | `error`, `agent_state`, `message`, `required_fields`, `next_action`, `documentation` | **yes** (Lane 8R.3 guidance) | absent | yes |
| 13 | generic natural-language JSON | `400` | 1.47 s | yes | same six keys | **yes** | absent | yes |
| 14 | missing prerequisites | `400` | 0.72 s | yes | same six keys | **yes** | absent | yes |
| 15 | invalid credentials | `401` | 0.79 s | yes | `agent_state`, `status`, `message`, `next_action`, `documentation` | **yes** | absent | yes |
| 16 | valid payment-ready quote, no `PAYMENT-SIGNATURE` | `402` | — | yes | x402 v2 challenge; `PAYMENT-REQUIRED` **present**; `x402Version: 2`, `scheme: exact`, `network: eip155:196`, `amount: 990000`, non-null `payTo`, quote-bound `resource` | yes | **present** | — |

Case 16 is **not re-run in this lane**: minting a fresh quote requires a verified email connection and a real enrollment, which the hard locks forbid (no fake users, requests, or quotes). It is carried forward unchanged from the already-proven production evidence `docs/proof/lane-8r-asp-update/production-402/contract-checks.json` (`gate3_contract_ok: true`). No genuine payment was performed in this lane or that one.

**The gap this table exposes:** the paid service's `402` is contract-perfect *once a quote exists*, and completely absent on first contact — which is the only contact an OKX validator or a first-time caller ever makes.

### Method and protocol probes

| Probe | `/v1/agent` | `/v1/agent/start-monitoring` |
|---|---|---|
| `GET` | `405` (empty body) | `405` (empty body) |
| `HEAD` | `405` | `405` |
| `PUT` | `405` | `405` |
| `OPTIONS` | `204` | `204` |
| `POST` + `text/plain` | `200` | `400` |
| `POST` + no `Content-Type` | `200` | `400` |
| `POST` + `x-www-form-urlencoded` | `400` | `400` |
| MCP `initialize` (JSON-RPC 2.0, `Accept: application/json, text/event-stream`) | **`400`** | — |
| MCP `tools/list` | **`400`** | — |
| MCP SSE stream open (`GET`, `Accept: text/event-stream`) | **`405`** | — |
| A2A `message/send` (JSON-RPC 2.0) | **`400`** | — |
| `/.well-known/agent-card.json`, `agent.json`, `ai-plugin.json`, `mcp.json`, `oauth-protected-resource`, `oauth-protected-resource/v1/agent` | all **`404`** | — |

`request-matrix/method-and-content-type-probes.json`, `request-matrix/mcp-a2a-protocol-probes.json`.

---

## 6. Latency and failure-path audit

| Path | Finding | Can it exceed an OKX task window? |
|---|---|---|
| Vercel cold start | Fluid Compute; measured first-hit costs in this lane were 1.4–1.9 s, worst single observed request 8.6 s (first live SerpApi call), repeats 0.6 s | **No** on the evidence — no probe approached a timeout |
| Route / runtime duration limits | Neither route exports `maxDuration` or `runtime`; there is no `vercel.json` / `vercel.ts`. Platform default applies | Not a limiter; the risk is the opposite — nothing caps the route |
| Groq timeout and retries | `src/ai/groq-client.ts`: `DEFAULT_TIMEOUT_MS = 20_000`, `MAX_RETRIES = 1`. An abort returns immediately at 20 s; a non-abort provider error retries once → **worst case ≈ 40 s** on `UNDERSTAND_PURCHASE` | **Yes, in principle.** Not observed (1.9–2.4 s measured) |
| SerpApi timeout and retries | `src/serpapi/client.ts`: `DEFAULT_TIMEOUT_MS = 15_000`, **no retries**. Discovery/check paths are bounded to one Shopping search plus at most one immersive enrichment (`max_immersive_searches: 1`) → **worst case ≈ 30 s** | **Yes, in principle.** Not observed |
| Database connection latency | `src/auth/auth-store.ts` `getPool()` creates `new Pool({ … max: 4 })` with **no `connectionTimeoutMillis` and no `statement_timeout`**. `pg` defaults `connectionTimeoutMillis` to `0` = wait forever. A slow or exhausted Postgres blocks the request **indefinitely**. (`src/policy/operations/adapters/postgres-adapter.ts` does set `connectionTimeoutMillis: 10_000`; the auth store does not.) | **Yes — this is the one genuinely unbounded wait on both registered endpoints** |
| Unbounded promises | No `waitUntil`, no `after()`, no fire-and-forget work on either route; every awaited call except the DB pool is bounded by an `AbortController` | No |
| Client-disconnect handling | Neither route reads `req.signal`; no abort propagation anywhere in `app/` | Cannot shed load, but does not itself cause a timeout |
| Response serialization | `NextResponse.json(...)` on every path; no streaming, no SSE, no chunked hand-rolled writer. Every `POST` probe in this lane returned parseable JSON | No |
| Rate limiting | In-memory sliding window, **per instance**: 30 req/min/client key default (`src/a2mcp/rate-limit.ts`), stricter for `UNDERSTAND_PURCHASE` (`src/ai/rate-limit.ts`). Keyed on `x-forwarded-for` | A `429` is a *fast* response, not a timeout. Only relevant if OKX egresses through a shared IP — **`NOT_PROVEN`**, no `429` was observed |

**Conclusion:** the only unbounded wait is the auth Postgres pool. Every other slow path is capped (Groq ≈ 40 s worst case, SerpApi ≈ 30 s worst case) and none of them was reachable by any probe an OKX first-contact caller actually makes — a first contact fails at parse in well under a second, long before any of these paths is entered.

---

## 7. Root-cause verdict

### Layer classification

| Layer | Verdict | Basis |
|---|---|---|
| Agent discovery | `CONTRIBUTING_CAUSE` | Not in public search while rejected; resolvable only by explicit agent ID |
| Service selection | `PASS` | `designated-route` resolves both services correctly and returns the free endpoint as the default |
| Listing-description input clarity | `CONTRIBUTING_CAUSE` | Neither description names a single wire input, action, or example request (§2.3) |
| Endpoint reachability | `PASS` | Public HTTPS, no protection, `/health` `200`, all probes < 10 s |
| DNS / TLS / redirects | `PASS` | Resolves, valid TLS with HSTS, zero redirects |
| Production routing | `PASS` | `usenobu.vercel.app` → `dpl_AUMLVaTCynKxqPL5HMMBT5ERsq6b`, the reviewed build; `X-Matched-Path` correct |
| Request method / content type | `CONTRIBUTING_CAUSE` | Content type is permissive, but `GET`/`HEAD` return `405` with an empty body — including to the official validator |
| Request-envelope compatibility | **`PRIMARY_CAUSE`** | Nobu accepts exactly one shape, `{"action":"<ENUM>", …}`. MCP `initialize` → `400`, MCP `tools/list` → `400`, MCP SSE open → `405`, A2A `message/send` → `400`, every natural-language envelope → `400`, every discovery document → `404`. The official OKX validator rejects **both** services (`valid: false`) |
| Free action schema | `PASS` | All three valid actions returned `200` with correct, parseable, bounded payloads |
| Paid-service prerequisites | `CONTRIBUTING_CAUSE` | First contact yields `400`/`401`, never the `402` challenge; `402` is reachable only after a quote that no first-time caller can hold |
| Cold start | `NOT_PROVEN` | Worst observed 8.6 s once, 0.6 s on repeat; no timeout observed |
| Groq latency | `NOT_PROVEN` | 20 s × 2 attempts is a real ceiling, but measured 1.9–2.4 s and unreachable before parse |
| SerpApi latency | `NOT_PROVEN` | 15 s × 2 calls is a real ceiling, but measured 2.5 s and unreachable before parse |
| Database latency | `CONTRIBUTING_CAUSE` | The auth `pg.Pool` has no connection or statement timeout — a genuinely unbounded wait on both registered routes. Not observed firing |
| Rate limiting | `NOT_PROVEN` | No `429` observed; a `429` would be fast anyway |
| Client disconnect | `NOT_PROVEN` | Not instrumented; `req.signal` is never read, so it cannot be evidenced either way |
| Response parseability | `PASS` for `POST` JSON | Every `POST` response in this lane parsed as JSON; `GET`/`HEAD` `405` bodies are empty, which is the method finding above, not a parse failure |
| x402 compatibility | `CONTRIBUTING_CAUSE` | Challenge content is contract-perfect once issued; the official validator still returns `valid: false` because it is never issued on first contact |
| Platform-side failure | `NOT_PROVEN` | No evidence either way; the OKX backend answered every read-only query in under 2.2 s |
| A2A / task channel responsiveness | `CONTRIBUTING_CAUSE` | Zero tasks ever, zero chat sessions ever, three inbound messages all parked as `invalid-json` and never answered, no daemon autostart, registration-time doctor `ready: false` — while `onlineStatus: 1` advertises availability |

### Required findings

**What OKX attempted.** Platform testing drove the flow a reviewer reaches from "I would like to use the services of agent ID 5541": resolve agent `#5541`, route to its designated services, and make first contact. An unattributed but unmistakable MCP/A2A client handshake against `https://usenobu.vercel.app/v1/agent` is recorded in the Vercel log (§4.2); a task was created on OKX's side and expired.

**Which service was called.** The free service `33561` at `https://usenobu.vercel.app/v1/agent` — it is the endpoint `designated-route` returns as the provider default and the one the observed handshake targeted. The paid service `35958` is reachable but fails the official validator independently.

**Whether the request reached Nobu.** **Yes.** Requests reach the correct Production deployment and are answered in under a second. Reachability, DNS, TLS, routing and the deployment binding are all clean.

**Where it stopped.** At **first contact / handshake**. Every probe an A2MCP or A2A client makes before it can send a business request fails: `GET` → `405` with an empty body, JSON-RPC `initialize` → `400`, `tools/list` → `400`, `message/send` → `400`, all six discovery documents → `404`, and the paid service's first-contact probe → `400` instead of `402`. The caller never obtains a session, a tool list, a payment challenge, or a machine-readable description of what to send.

**Whether Nobu returned a response.** **At the HTTP layer, yes — fast and well-formed.** Every registered endpoint answers in 0.5–2.5 s (worst single case 8.6 s) with parseable JSON. But every one of those answers is a rejection that gives an MCP/A2A caller nothing to proceed with, so from OKX's side the *agent* never responded. On the **A2A/task channel the answer is an unqualified no**: nothing has ever been routed, dispatched, or answered there, while a 60-second heartbeat keeps reporting `onlineStatus: 1`.

**Proven primary cause.** `PRIMARY_CAUSE — request-envelope / first-contact protocol incompatibility.` Nobu's registered A2MCP endpoints implement a bespoke `{"action": …}` JSON API and publish no discovery document, no tool list, and no first-contact affordance. An OKX-side caller cannot construct a valid request from anything Nobu or the listing exposes. This is proven by the **official OKX tool**: `agent x402-check` returns `valid: false` for both services — `405` for the method it probes with, `400` for the body it probes with — and by the recorded external MCP/A2A handshake in which all six steps failed.

**Contributing causes.**

1. Paid-service prerequisites / x402 compatibility — `402` is only ever issued after a quote, so first contact returns `400`/`401`.
2. Listing-description input clarity — no wire inputs, no action names, no example request in either description.
3. Method handling — `GET`/`HEAD` return `405` with an empty body and no content type, including to OKX's own validator.
4. A2A / task-channel responsiveness — never routed, never answered, no autostart, doctor `ready: false`, yet advertising online.
5. Agent discoverability while rejected — search-invisible, so only explicit-ID routing works.
6. Unbounded auth Postgres pool (`connectionTimeoutMillis` unset) — the one path that could hang indefinitely.
7. Observability — sub-hour request-log retention and no method/content-type/key-name/disconnect logging, which is why the review window itself cannot be reconstructed.

**Minimum repair required for Lane 8R.3B.** One targeted repair: **make first contact succeed on both registered endpoints.**

1. **Read the official contract first.** `https://web3.okx.com/onchainos/dev-docs/okxai/howtomcp` and `…/how-to-become-a2a` must be fetched from a network that can reach `web3.okx.com` (this environment cannot — §1.0) and used as the authority for the exact shape. Do not implement from inference.
2. Make `POST` to a registered endpoint with **no recognised action** return a `200` machine-readable self-description — service name, available actions, required fields per action, and an example request — instead of a `400` Zod discriminator dump.
3. Make `GET` on a registered endpoint return that same descriptor rather than a bodyless `405`.
4. Make the paid endpoint emit its existing, already-correct x402 `402` + `PAYMENT-REQUIRED` challenge on **first contact**, so `agent x402-check` returns `valid: true`.
5. Serve whichever discovery document the official docs require (`/.well-known/agent-card.json` and/or MCP protected-resource metadata) — decided from the docs, not guessed.

Then, and only then, rewrite both service descriptions to name their exact inputs and an example request, and resubmit. Everything above is scoped to Lane 8R.3B and **is not implemented in this lane**.

---

## Hard-lock compliance

| Lock | Status |
|---|---|
| Existing ASP `#5541` only | Held — read-only queries only; no `agent update`, `activate`, `deactivate`, `create`, or avatar upload |
| No code, deployment or ASP changes | Held — no file under `app/`, `src/`, or `openapi/` modified; no deploy; `git status` clean apart from this proof directory and the two permitted docs |
| No genuine payment | Held — no `payment pay`, no `task-402-pay`, no `PAYMENT-SIGNATURE` ever sent; case 16 reuses prior evidence |
| No fake users, requests, quotes, alerts, results or settlements | Held — invalid-credential probes use obviously synthetic placeholders and are rejected; no account, quote, monitor, or email was created |
| Never expose request values, emails, tokens, payment headers, wallet addresses or secrets | Held — wallet/owner/communication addresses masked; XMTP message content omitted; no header values recorded |
| Do not guess | Held — the unreachable official doc is marked `UNRESOLVED_FROM_DOCS` rather than reconstructed; probe-burst attribution is marked `NOT_PROVEN` |
| Stop if the request path cannot be safely inspected | Not triggered — the path was inspected safely end to end |

## Evidence index

| File | Contents |
|---|---|
| `okx-readonly/asp-5541-state-redacted.json` | Rejection status, exact remark, agent description, addresses masked |
| `okx-readonly/services-33561-35958.json` | Both services: name, type, fee, endpoint, full description |
| `okx-readonly/x402-check-official.json` | Official `agent x402-check` verdicts (`valid: false` ×3) |
| `okx-readonly/designated-route-5541.json` | Raw designated-provider routing response |
| `okx-readonly/marketplace-discoverability.json` | Search invisibility while rejected; routing still resolves |
| `okx-readonly/reference-listed-asp-description-format.json` | Description-format reference from an approved listed A2MCP peer |
| `okx-readonly/a2a-channel-state.json` | Task/session/inbound-message state, metadata only |
| `request-matrix/matrix-results.json` | The 15-case reviewer matrix with timings |
| `request-matrix/method-and-content-type-probes.json` | Method and content-type behaviour on both endpoints |
| `request-matrix/mcp-a2a-protocol-probes.json` | MCP and A2A protocol-shape probes and discovery-document probes |
| `vercel/request-log-correlation.json` | 49 correlated records, retention finding, unattributed probe burst |
| `vercel/production-deployment-identity.md` | Deployment and alias binding for `usenobu.vercel.app` |
