# Lane 8R.3B — A2MCP and Monitoring Pass repair

**Status:** `NOBU_LANE_8R_3B_READY_FOR_OPERATOR_ALIGNMENT_AND_PROOF`
**Date:** 2026-07-26
**Base commit:** `32ddaa0` · **Repair commit:** `1dac265`
**Production deployment:** `dpl_HLZD27xLrSsRA6aFaaXBhFkd5wgB` (`usenobu-j2kc5se0f`), explicitly re-aliased to `www.usenobu.xyz`

**Not `PASS`.** ASP `#5541` service `35958` still points at the old `/v1/agent/start-monitoring` endpoint. The single metadata update that repoints it is prepared but deliberately **not executed** — see `operator-runbook.md`. No `agent update`, no activation, no resubmission, and no genuine payment was performed in this lane.

---

## 1. Authority

The lane names `https://web3.okx.com/onchainos/dev-docs/okxai/howtomcp`. That host remains unreachable from this machine (local DNS blocked; DoH resolves to two Cloudflare edge IPs but TCP:443 is refused to both, while a control host returns `200`). The operator independently checked the guide and supplied its requirements, which this repair was built against:

| # | Requirement | Result |
|---|---|---|
| 1 | Free endpoint returns `200` with a useful result on a direct bodyless `POST` | **Met** — `200` `status: READY` descriptor, 0.85 s |
| 2 | Paid endpoint returns `402` on every initial call, before business execution | **Met** — `402` on bodyless POST, GET, and `{}` |
| 3 | Paid request replayed after payment returns its clear service result | **Met** — `MONITORING_PASS_ISSUED` (test-mode settlement; genuine payment is an operator item) |
| 4 | x402 v2 challenge base64-encoded in the `PAYMENT-REQUIRED` **header** | **Met** — 776-byte header; encoder changed from base64url to standard base64 so the official buyer's `atob` decode works |
| 5 | Decoded challenge carries `x402Version: 2`, `resource.url`, accurate `resource.description`, `resource.mimeType: application/json`, `accepts[].scheme: exact`, `accepts[].network: eip155:196`, official X Layer USD₮0 asset, server-controlled amount and `payTo`, `maxTimeoutSeconds`, correct token name/version | **Met** — see `production/payment-required-challenge-redacted.json` |
| 6 | Official self-check: bodyless `POST` free → `200 + result`; bodyless `POST` paid → `402 + PAYMENT-REQUIRED` | **Met** — both, every time |
| 7 | Both endpoints publicly reachable over HTTPS | **Met** |

Field encoding, replay semantics (`PAYMENT-SIGNATURE`), and verification/settlement follow the installed official `okx-agent-payments-protocol` skill **v4.2.4**. It did not conflict with any requirement above. Two details taken from it directly: the buyer decodes the challenge with `atob` (hence standard base64), and `exact` + EIP-3009 signing needs `accepts[].extra.name` with `version` defaulting to `"2"`.

**Token metadata was read, not assumed.** `name()` on the settlement asset at X Layer returns 7 UTF-8 bytes `55 53 44 e2 82 ae 30` = `USD₮0`. The contract implements no `version()` or `eip712Domain()`, so the documented default `"2"` applies.

No A2A, MCP SSE, `tools/list`, or guessed discovery document was implemented.

---

## 2. What changed

### Free service `33561` — `https://www.usenobu.xyz/v1/agent` (endpoint unchanged)

A bodyless `POST`, `{}`, or any envelope with no recognised `action` (`message`, `query`, `prompt`, or anything else) now returns `200` with a `status: READY` descriptor listing every supported action with its required fields, the recommended first action, one working example request, the paid service, and a clear `next_action`. `GET` returns the same descriptor.

The descriptor is **pure** — `buildFreeServiceDescriptor()` performs no Groq, SerpApi, email, or Postgres work, and a focused test builds it with no database configured at all. Production first contact measured **1–3 ms** of server time.

Malformed JSON still returns `400`, now guided (`error`, `status`, `message`, `next_action`, `documentation`). A **recognised** action with invalid fields still returns its existing `400` — valid-action behaviour is unchanged, and a focused test asserts that every recognised action name is never treated as first contact.

### Paid service `35958` — new endpoint `https://www.usenobu.xyz/v1/agent/monitoring-pass`

Sells one `$0.99` **Nobu Monitoring Pass**. Every initial call — `GET` or `POST`, body or none — returns `402` with the base64 x402 v2 challenge in `PAYMENT-REQUIRED`, **before any business execution and with no quote, connection, purchase or consent consulted**. That is the whole repair: Lane 8R.3A proved prerequisite-gated first contact was why OKX's validator reported `valid: false`.

After official OKX verification and successful settlement, the replay returns `200` with `agent_state: MONITORING_PASS`, `status: MONITORING_PASS_ISSUED`, `monitoring_pass_id`, a one-time opaque `monitoring_pass_token`, price, `redeemable_for`, and `next_action`.

Exactly-once issuance is anchored on the **OKX-verified settlement reference**, never on anything a caller supplies:

- `monitoring_passes.settlement_ref` is `UNIQUE` — one verified settlement can only ever produce one pass;
- a duplicate, concurrent, or lost-response replay re-verifies to the same settlement reference and resolves to the same pass; only the call that actually minted the pass ever learns the token;
- a pending settlement is recorded against the **sha256 digest** of the replay header and stays recoverable by polling the official settle-status API — it never re-verifies or re-charges.

`/v1/agent/start-monitoring` is unchanged and remains internal until safely retired.

**Design note stated explicitly:** the brief says "server-signed opaque `monitoring_pass_token`". This is implemented as a 32-byte random token of which only the sha256 hash is stored — the same pattern Lane 7.4B uses for `connection_token`. It is opaque and server-issued, but it is a random credential, not an HMAC-signed one. Single-use consumption requires a durable read regardless, so signing would add no security here; the token is never stored or logged in plaintext.

### Pass redemption — free action `REDEEM_MONITORING_PASS`

Every gate the paid endpoint deliberately no longer enforces still applies here, unchanged: valid unused pass, authorized connection, valid unexpired quote owned by that connection at locked terms, confirmed exact product (fingerprint match), current Target eligibility (`MONITORING_PAYMENT_READY`), both consents durably recorded, and no conflicting activation. **Every failed validation returns before the redemption transaction, so the pass is never consumed.** Valid redemption consumes the pass and inserts the activation in one atomic transaction, then reuses the existing Lane 7.4D `pending_projection → active` saga and `reconcilePendingActivations`.

### Reliability

- Bounded Postgres waits: `connectionTimeoutMillis: 5_000`, `statement_timeout` / `query_timeout: 8_000`, `idleTimeoutMillis: 30_000`. Lane 8R.3A identified `pg`'s default of "wait forever" as the only genuinely unbounded path on both registered endpoints.
- Groq (20 s, 1 retry) and SerpApi (15 s, no retries) remain explicitly bounded, and **no first-contact response depends on either**.
- Safe structured logging on both routes: method, route, content type, content length, sorted top-level key **names**, recognised action, status, duration, disconnect flag. Sensitive key names (`connection_token`, `monitoring_pass_token`, `password`, …) are replaced with `[redacted-name]`. No field values, headers, emails, tokens, or addresses are ever logged. Verified live in production — `production/structured-request-logs.json`.

---

## 3. Local proof

`tests/payments/monitoring-pass.test.ts` — **20 focused tests, all passing.**

| Proof point | Covered by |
|---|---|
| Free bodyless / `{}` / envelopes are first contact | first-contact classification test |
| Existing valid actions unchanged | recognised-action test + `runAgentAction` dispatch test |
| Descriptor is useful and self-describing | descriptor test (every advertised action is dispatchable and declares required fields) |
| Descriptor touches no dependency | purity test (builds with no database configured) |
| Paid first contact → valid `402` | challenge test (v2, resource object, exact, `eip155:196`, `990000`, `maxTimeoutSeconds`, `extra.name`/`version`, no quote binding, base64 round-trip) |
| Rejected payment creates no pass | rejecting-verifier test |
| Settled replay creates one pass | issuance test |
| Duplicate replay returns the same pass | duplicate-replay test (token returned exactly once) |
| Concurrent replay returns the same pass | `Promise.all` test (exactly one pass, exactly one token) |
| Invalid redemption does not consume | wrong token / wrong connection token / unknown quote / expired quote |
| Valid redemption activates exactly once | redemption test + replay returns `ALREADY_ACTIVE` |
| A redeemed pass cannot be reused | second-purchase test (second quote left `issued`) |
| Concurrent redemption activates once | `Promise.all` redemption test |
| Projection recovery requires no new payment | stuck-projection test (one pass, one activation, one payment after recovery) |
| No sensitive data leakage | raw header and token absent from all rows and responses; failed-redemption bodies byte-identical across distinct causes |

**Suite state.** `tests/payments/` — **47 passed / 47**. Typecheck clean. `next build` clean, with `/v1/agent/monitoring-pass` present in the route manifest.

**Pre-existing failures, not caused by this lane.** The full suite reports `19 failed | 434 passed | 1 skipped`. Running the same six files at clean `32ddaa0` with the lane stashed gives the **identical** `19 failed`. They are a hardcoded-date time bomb (fixed purchase dates that have aged out of Target's adjustment window) plus the long-known `tests/matching/store.test.ts` migration-list assertion. This lane fixed that time bomb **only** in the three payment test files it directly depends on, by deriving the purchase date relative to today; the remaining files were left alone as out of scope.

Baseline evidence: `pre-existing-failures.md`. **All 19 were subsequently fixed in Lane 8R.3B.1** — the suite is now fully green; see that file's header.

---

## 4. Production proof

Deployment `dpl_HLZD27xLrSsRA6aFaaXBhFkd5wgB`, alias `www.usenobu.xyz` re-pointed explicitly (it does not auto-follow `vercel deploy --prod`).

| Case | Method | Status | Duration | `PAYMENT-REQUIRED` |
|---|---|---|---|---|
| free, no body | POST | **200** | 0.85 s | — |
| free, GET | GET | **200** | 0.83 s | — |
| free, `{}` | POST | **200** | 0.90 s | — |
| free, `message` envelope | POST | **200** | 0.69 s | — |
| free, `query` envelope | POST | **200** | 0.80 s | — |
| free, `prompt` envelope | POST | **200** | 0.72 s | — |
| free, malformed JSON | POST | 400 (guided) | 0.74 s | — |
| free, valid `UNDERSTAND_PURCHASE` | POST | **200** | 4.24 s | — |
| free, recognised action, missing fields | POST | 400 | 0.71 s | — |
| paid, no body | POST | **402** | 0.53 s | **present** |
| paid, GET | GET | **402** | 0.69 s | **present** |
| paid, `{}` | POST | **402** | 0.75 s | **present** |
| paid, bogus signature | POST | **402** (fails closed, no pass) | 1.83 s | **present** |

**Every first-contact response arrived within five seconds.** Evidence: `production/first-contact-matrix.json`.

### Official OKX validator

| Endpoint | Verdict |
|---|---|
| **new** `/v1/agent/monitoring-pass`, no body | **`valid: true`** — x402 v2, `exact`, `eip155:196`, USDT, 6 decimals, `990000` = 0.99, non-null server `payTo` |
| **new** `/v1/agent/monitoring-pass`, body `{}` | **`valid: true`** |
| **old** `/v1/agent/start-monitoring` (still the registered endpoint on `#5541`) | `valid: false` — `Endpoint returned HTTP 405 (not 402)` |

That last row is exactly why the operator metadata update is required before this lane can become a PASS. Evidence: `production/x402-check-official.json`.

---

## 5. Hard-lock compliance

| Lock | Status |
|---|---|
| Preserve ASP `#5541` and service IDs `33561` / `35958` | Held — no OKX write of any kind |
| No second ASP | Held |
| No activation or resubmission | Held |
| Target remains the only live retailer | Held — no retailer code touched |
| No weakened identity, confirmation, consent, eligibility, matching or payment gates | Held — every gate moved intact to redemption; a failed redemption never consumes the pass |
| No fake user, payment, settlement, pass, activation or alert | Held — settlement fakes exist only behind `isAuthTestMode`, which `resolveX402Verifier` throws on outside test mode; production fails closed without seller credentials |
| No secrets, payment headers or bearer tokens logged | Held — only a sha256 digest is persisted; sensitive key names redacted in logs; proof files mask `payTo` |
| Focused changes and tests only | Held |
| Stop on the first material failure | No material failure; the 19 pre-existing failures were baselined as identical at `32ddaa0` |

---

## 6. What remains

Everything left is operator-controlled and state-changing. See **`operator-runbook.md`** for the exact ordered steps, with all sensitive values as placeholders:

1. Review and execute the single ASP metadata update (both services together).
2. Immediately read back ASP `#5541` and both service records.
3. Record the resulting QA/review status; run no further state-changing command without explicit authorization.
4. Run designated routing and official `x402-check`.
5. Complete one genuine `$0.99` Monitoring Pass payment and replay.
6. Use a legitimate OKX.ai User-role identity for the exact prompt `I would like to use the services of agent ID 5541`.
7. Review all evidence before any separate activation or resubmission decision.

---

## Evidence index

| File | Contents |
|---|---|
| `production/first-contact-matrix.json` | 13 production probes with status, duration, safe response keys, header presence |
| `production/x402-check-official.json` | Official validator verdicts for the new and old paid endpoints (`payTo` masked) |
| `production/payment-required-challenge-redacted.json` | The live decoded challenge (`payTo` masked) |
| `production/structured-request-logs.json` | Live structured log lines proving the Lane 8R.3A observability gap is closed |
| `pre-existing-failures.md` | Stashed-baseline proof that the 19 remaining suite failures pre-date this lane, plus their Lane 8R.3B.1 resolution |
| `operator-runbook.md` | The exact remaining state-changing steps, with placeholders |
