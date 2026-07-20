# Lane 7.4B — Agent connection and conversational email verification

**Verdict:** `NOBU_LANE_7_4B_PASS`

## What shipped

- Durable `agent_connections` / `agent_email_codes` tables in the same
  durable AuthStore as `auth_accounts` (`src/auth/durable-schema.ts`) —
  PostgreSQL in production, SQLite for tests/local, never per-instance
  storage or the browser cookie snapshot.
- `BEGIN_EMAIL_VERIFICATION` — creates a pending connection, sends an
  exactly-six-digit cryptographically secure code (rejection-sampled,
  `src/auth/crypto.ts#randomSixDigitCode`) through the existing Resend-backed
  email provider pattern (`src/auth/email.ts#sendAgentEmailCode`). Never
  reveals whether the email already has an account — no account row is
  touched until verification succeeds. Per-email and per-request-source rate
  limits reuse the existing `auth_rate_limits` bucket pattern.
- `VERIFY_EMAIL_CODE` — 10-minute expiry, maximum 5 wrong attempts (then a
  fresh `BEGIN_EMAIL_VERIFICATION` is required), atomic one-time consume
  (concurrent/replayed verification loses). On success: upserts + verifies
  the email account (reusing `AuthStore.upsertAccountForEmail` /
  `markAccountVerified` — no browser session/cookie is created), activates
  the connection, mints a high-entropy `connection_token`, returns it once,
  and stores only `connection_token_hash`.
- `REVOKE_AGENT_CONNECTION` — requires valid authorization; sets
  status/`revoked_at` and clears the token hash; added `CONNECTION_REVOKED`
  as the minimal truthful success status.
- Shared `authorizeAgentConnection` helper
  (`src/auth/agent-connections.ts`) — `connection_id` is a non-secret
  handle only; every protected action also requires a valid, unexpired
  `connection_token` matching the stored hash. Unknown, missing, wrong,
  expired, and revoked credentials all return the same generic
  `ACTION_NOT_AUTHORIZED` (HTTP 401). Successful authorization updates
  `last_used_at`.
- Internal `rotateAgentConnectionToken` helper — replaces the token hash and
  immediately invalidates the old token; reused by the same store primitive
  (`setAgentConnectionCredential`) that activation uses.
- Wired additively into the existing bounded `/v1/agent` dispatcher
  (`src/ai/agent-service.ts`, `src/ai/schemas.ts`). The three pre-existing
  live actions (`UNDERSTAND_PURCHASE`, `CHECK_CONFIRMED_PURCHASE`,
  `CHECK_MONITORING_STATUS`) are unchanged.

## Not built (hard locks)

Discovery, confirmation, consent, preflight, quotes, payments, x402,
monitoring activation, and monitor management remain untouched — Lane 7.4C+
territory. ASP #5541 was not deployed, edited, or resubmitted.

## Proof

| Check | Result |
|---|---|
| Code expiry / attempt limit / one-time consume | `tests/auth/agent-connections.test.ts` — pass |
| Token stored hashed, returned once | same file — pass |
| Authorization: handle-only / wrong / expired / revoked → same generic rejection | same file — pass |
| Rotation invalidates the old token | same file — pass |
| Revocation (valid auth required; wrong token rejected) | same file — pass |
| Two connections cannot authorize each other | same file — pass |
| Existing `/v1/agent` actions unchanged | same file + `tests/ai/understand-purchase.test.ts`, `tests/a2mcp/a2mcp.test.ts` — pass |
| Full new-action count | `tests/auth/agent-connections.test.ts` — 12 passed |
| Focused auth regressions | `tests/auth/passwordless-auth.test.ts` — 8 passed |
| Combined targeted run (auth + ai + a2mcp + notifications + web) | 192 passed / 20 files |
| typecheck (`tsc --noEmit`) | pass |
| build (`next build`) | pass |
| `git diff --check` | clean (CRLF conversion notices only, no whitespace errors) |
| Sensitive-output scan | pass — logging only ever uses hashed email markers (`hashEmail`); no raw code, token, or email appears in any log call, response schema example, or this proof bundle |

Full targeted run:

```
tests/auth/agent-connections.test.ts   12 passed
tests/auth/passwordless-auth.test.ts    8 passed
tests/ai/understand-purchase.test.ts   31 passed
tests/a2mcp/a2mcp.test.ts              15 passed
tests/notifications/email-alerts.test.ts 10 passed
tests/web/*                            116 passed
------------------------------------------------
Test Files  20 passed (20)
Tests       192 passed (192)
```

Pre-existing, unrelated failures confirmed on `HEAD` (`0802381`) before this
change, in `tests/db/embedded-migrations.test.ts` and
`tests/matching/store.test.ts` (both about migration `0007_email_alerts`
naming, untouched by this lane) — verified via `git stash` and are not part
of this lane's proof surface.

## Illustrative flow shape (all values fabricated/redacted)

See `redacted-flow-example.json`. No real email address, code, or token was
ever generated, sent, or captured for this file — every value is a
structurally-shaped placeholder for documentation only.

## Changed files

- `src/auth/durable-schema.ts` — `agent_connections`, `agent_email_codes` tables
- `src/auth/auth-store.ts` — store interface + Postgres/SQLite adapter methods
- `src/auth/crypto.ts` — `randomSixDigitCode`
- `src/auth/email.ts` — `sendAgentEmailCode` (+ test-mode capture, never logged)
- `src/auth/agent-connections.ts` — new service module (begin/verify/authorize/rotate/revoke)
- `src/auth/index.ts` — export wiring
- `src/ai/schemas.ts` — three new `AgentRequestSchema` variants
- `src/ai/agent-service.ts` — dispatch wiring, `AgentServiceDeps`/`AgentServiceResult` extended
- `app/v1/agent/route.ts` — passes `sourceKey` through for per-source rate limiting
- `openapi/nobu-agent-native-paid-monitoring-proposed.openapi.yaml` — marks the three implemented actions/statuses, keeps the rest explicitly proposed
- `tests/auth/agent-connections.test.ts` — new focused test suite (12 tests)

## Hard locks preserved

- No discovery/confirmation/consent/preflight/quotes/payments/x402/monitoring/monitor-management code added
- ASP #5541 not deployed, edited, or resubmitted
- No raw email, code, or token logged or placed in this proof bundle
- Target-only MVP, fail-closed matching/policy, no refund guarantees — untouched
