# Lane 8R.3 — Audit and repair OKX listing-review capability mismatch

**Date:** 2026-07-23
**Verdict:** `NOBU_LANE_8R_3_PASS`
**Base commit:** `353c7a4d7b26ca215fa4bb2f5fa82ca3d2d5e5e3`

## 1. Rejection status (read-only inspect)

ASP `#5541` **"Nobu"**:

- `approvalDisplayStatus: 5` — **Listing rejected**
- `approvalRemark`: *"During platform testing, we found that the results returned by your service in actual calls don't match the capabilities stated in your service description. ... 1. Update your description to match your service's actual functionality, or redeploy your service so it matches the description. 2. Once done, re-verify that your service is working, then resubmit."*

Services (both preserved throughout this lane, never edited):

| Service | ID | Fee | Endpoint |
|---|---|---|---|
| Nobu Purchase Setup | `33561` | `0` | `https://usenobu.vercel.app/v1/agent` |
| Nobu Monitoring Activation | `35958` | `0.99` | `https://usenobu.vercel.app/v1/agent/start-monitoring` |

Full agent + service records: `asp-5541/before-rejection.json`.

## 2. Production logs

`vercel logs usenobu.vercel.app --since 7d --environment production` returned only 8 entries, all `www.usenobu.xyz` page/asset requests from the last hour — no `/v1/agent` traffic in the retained window (this Vercel plan's log retention is far shorter than 7 days). No OKX-reviewer request could be located directly; root cause was established by reproduction instead (§3).

## 3. Reproduction against production (before fix)

All calls in `reproduction-before-fix/`, run against the then-current production deployment (`dpl_958qAQ7VARekeW9FjRx6Nj8AET1w`):

| Case | Call | Result | Matches description? |
|---|---|---|---|
| 1a/1b | Empty / malformed body to `/v1/agent` | `400`, lists all valid `action` values | Yes — informative |
| 2/2b | Generic natural-language body to `/v1/agent` | `400`, same informative action list | Yes — informative |
| 3 | Minimum documented free request (`UNDERSTAND_PURCHASE`) | `200`, correct extraction | Yes |
| 4a | Empty body to `/v1/agent/start-monitoring` | `400` **`{"error":"invalid_input"}`** | **No — opaque** |
| 4b | Well-shaped but fabricated `quote_id`/`connection_id`/`connection_token` | `401` **`{"agent_state":"MONITORING_ACTIVATION","status":"ACTION_NOT_AUTHORIZED"}`** | **No — opaque** |
| 4c | Natural-language body to the paid endpoint | `400` **`{"error":"invalid_input"}`** | **No — opaque** |
| extra | `DISCOVER_PRODUCT` with missing nested fields | `400`, `"purchase":["Required","Required"]` (no field names) | Degraded but secondary |
| 5a–5g | Full controlled flow: `DISCOVER_PRODUCT → CONFIRM_PRODUCT → BEGIN_EMAIL_VERIFICATION → VERIFY_EMAIL_CODE → PREFLIGHT_MONITORING → unpaid start-monitoring` | Correct `402` x402 v2 challenge bound to the issued quote; `LIST_ACTIVE_MONITORS` count `0` after | Yes — matches the paid description exactly **when the caller already has a valid quote** |

## 4. Root cause

**Endpoint usability on the paid service (`35958`), not listing copy.**

Both registered service descriptions were already accurate — the free service's "does not activate paid monitoring" and the paid service's "activates ... after verified $0.99 OKX payment ... requires verified connection, valid enrollment quote, completed OKX payment" both match the implemented behavior exactly (case 3 and case 5 above confirm this).

The mismatch: a paid A2MCP service can only ever be reached by a caller who **already has** a `quote_id`/`connection_id`/`connection_token` from completing the free flow first — no caller can succeed on a first call to the paid endpoint. The most natural way for an OKX reviewer to test a service literally named "Nobu Monitoring Activation" is to call it directly. Before this fix, that call received a bare `{"error":"invalid_input"}` (400) or `{"status":"ACTION_NOT_AUTHORIZED"}` (401) with **no indication that this is expected, no required-field list, no pointer to the free flow that produces valid credentials, and no documentation reference** — indistinguishable from a broken/unimplemented service. This plausibly reads to a reviewer as "the service doesn't do what its description says."

This is not an auth/gate weakness — the endpoint correctly refuses unprepared callers. The problem is purely that the refusal was silent about *why* and *what to do next*.

## 5. Repair

Endpoint-usability fix only — no gate, no listing-copy change:

- `app/v1/agent/start-monitoring/route.ts`: the schema-violation (400) and `ACTION_NOT_AUTHORIZED`/`CONNECTION_EXPIRED` (401/404) response bodies now additionally carry `message`, `required_fields` (400 only), `next_action`, and `documentation` (`https://usenobu.vercel.app/okx`).
- The `next_action`/`message` text is **identical** for `ACTION_NOT_AUTHORIZED` and `CONNECTION_EXPIRED` — deliberately reason-agnostic, so the response still never reveals which specific check failed (unknown quote vs. wrong token vs. expired vs. price-altered stay indistinguishable, exactly as documented pre-existing behavior required).
- New `src/payments/start-monitoring-response.ts` holds this presentation logic (extracted out of `route.ts`, which cannot have extra named exports under Next.js's route-file typing).
- `openapi/nobu-agent-native-paid-monitoring-proposed.openapi.yaml` updated to document the new additive fields on the 400/401/404 responses.
- No change to `authorizeAgentConnection`, quote validation, payment verification, or any matching/policy code.
- No change to either registered service description or the agent-level description (verified byte-identical before/after in `asp-5541/`).

## 6. Proof

- Focused contract tests: `tests/payments/start-monitoring-route-guidance.test.ts` (7 tests, all new behavior only) — all pass.
- Full directly-affected regressions: `tests/payments/start-monitoring.test.ts`, `tests/payments/okx-seller-adapter.test.ts` — all pass unchanged.
- `npx tsc --noEmit`: clean.
- `next build`: clean (route-level export constraint required extracting the presentation helpers into `src/payments/start-monitoring-response.ts`).
- `git diff --check`: clean.
- Secret/payment-material scan of the diff and all proof evidence: clean (see redaction notes below).
- `tests/matching/store.test.ts` and `tests/db/embedded-migrations.test.ts` fail on a pre-existing, unrelated hardcoded-migration-list assertion — reproduced identically on the unmodified base commit via `git stash`, confirmed out of scope.

### Production redeploy

- `vercel deploy --prod --yes` → `dpl_AUMLVaTCynKxqPL5HMMBT5ERsq6b` (Ready), auto-aliased `www.usenobu.xyz`.
- `usenobu.vercel.app` is a manually-pinned alias (does not auto-follow `--prod` deploys on this project — see prior-lane note) — repointed explicitly with `vercel alias set https://usenobu-9bt7yc5t2-dtwoflicks-2878s-projects.vercel.app usenobu.vercel.app`.
- `GET /health` → `200` after repoint.

### Reproduction against production (after fix)

All calls in `reproduction-after-fix/`:

- Case 4a/4c (`invalid_input`) now return `required_fields`, `next_action`, and `documentation` alongside the unchanged `error` field.
- Case 4b (`ACTION_NOT_AUTHORIZED`) now returns `message`, `next_action`, and `documentation` alongside the unchanged `status` field — no new information about *which* check failed.
- Free-service smoke (`UNDERSTAND_PURCHASE`) unchanged — `free-service-smoke.json`.
- Full case-5 flow repeated end-to-end against the fixed deployment with a second controlled truthful purchase and a fresh disposable inbox: `DISCOVER_PRODUCT → CONFIRM_PRODUCT → BEGIN_EMAIL_VERIFICATION → VERIFY_EMAIL_CODE → PREFLIGHT_MONITORING → unpaid start-monitoring`. The `402` challenge (`case5f-unpaid-402-contract-checks.json`) is byte-identical in shape to the before-fix challenge (same `x402Version`, `scheme`, `network`, `asset`, `amount`, `resource`) — confirms the fix changed nothing about the payment contract.
- `LIST_ACTIVE_MONITORS` → count `0` after the unpaid call — no activation, no settlement, no genuine payment, no active monitor.

## 7. ASP #5541 resubmission

- No `agent update` call was made — zero listing-copy or service-field changes (root cause was runtime behavior, not description text).
- `agent activate --agent-id 5541 --preferred-language en-US` (the OKX-documented "resubmit" action) — required first fixing a local `okx-a2a` A2A-readiness prerequisite (`okx-a2a doctor --fix`, run by the operator; unrelated to Nobu's code).
- Response: `submitApproval: [{ "approvalStatus": 2, "success": true }]`.
- Read-back (`asp-5541/after-resubmission.json`): `approvalDisplayStatus: 2` — **"Listing under review"** (no longer `5`/"Listing rejected"). Both services (`33561`, `35958`) unchanged.

## 8. Hard locks held

- Same ASP `#5541`; no second ASP created.
- Free service `33561` and paid service `35958` preserved, fee/endpoint unchanged.
- No genuine payment at any point (`LIST_ACTIVE_MONITORS` count `0` both before and after).
- No fake purchase/result/alert/settlement — both case-5 runs used one real, truthful, controlled Target purchase (Apple AirTag, `A-84379777`) reaching only `MONITORING_PAYMENT_READY`/`PAYMENT_PENDING`, never activation.
- No Target scraping (existing SerpApi/Target-discovery path, unchanged).
- Zero ASP updates; exactly one resubmission.
- No weakening of authentication, consent, payment, or matching gates — every added field is presentation-only, and the two failure statuses still return identical guidance text (no information leak about which check failed).

## Next lane

Lane 8R.3 does **not** unblock Lane 7.4G. Lane 7.4G still requires ASP `#5541` and the paid service to be **officially accessible through OKX.AI** (i.e., marketplace approval, not just "under review" again) before it may start. Current status: **under review**, not yet approved/public.
