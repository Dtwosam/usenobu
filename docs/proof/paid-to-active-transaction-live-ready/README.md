# Paid-to-active transaction live-ready closeout

**Date:** 2026-08-05  
**Baseline:** `63a999fd68c7e0808bc843bff562ff8b88b95937`

## Verdict

**`NOBU_PAID_TO_ACTIVE_TRANSACTION_CLOSEOUT_BLOCKED`**

Code and focused proofs pass. Authenticated Production readiness boolean body could not be recorded: Vercel CLI redacts Sensitive secrets on `env pull` / `env run` (values empty). Wrong-token probe returns **401** (owner secret is configured on the server, not missing). `NOBU_PASS_CLAIM_SECRET` was **missing** from Production and was added (64-char hex; value not printed or committed).

Do **not** authorize a genuine payment until an operator with the live `OWNER_OPS_SECRET` confirms all six readiness booleans are `true`.

## Repairs

### 1. Failed settlement binding

- `decision=failed` requires binding commercial fields (network, asset, payTo, amount when exposed, payer when known)
- Unrelated bare facilitator failure keeps `settlement_review_required`
- Failed decisions still claim the canonical settlement_ref so it cannot unlock another payment

### 2. Canonical settlement references

- `canonicalizeSettlementRef`: trim, hex validate, lowercase
- Used for facilitator queries, claims, payments, passes, audits, duplicates
- All store paths normalize to lowercase; lookups use `lower(settlement_ref)`

### 3. Rolling 24-hour summary limit

- `durable_summary_send_state` with `last_sent_at` + short-lived reserve
- `tryReserveRollingSummarySend` / `markRollingSummarySent` / `releaseRollingSummaryReserve`
- Calendar-day buckets no longer authorize sends
- Midnight-adjacent attempts suppressed; exactly 24h later allowed

### 4. Production readiness

- `GET /v1/owner/config-readiness` (owner-only, booleans only)
- `NOBU_PASS_CLAIM_SECRET` added to Production (was missing from env list)
- Authenticated body probe: Vercel CLI redacts Sensitive secrets on pull/`env run` (empty values)
- Indirect: wrong bearer → **401** (not 503), proving owner secret is live on the server

## Focused gates

| Gate | Result |
|------|--------|
| Failed-settlement binding tests | PASS |
| Mixed-case settlement-ref tests | PASS |
| Rolling summary rate tests | PASS |
| Related settlement/outbox suites | PASS |
| Typecheck | PASS |
| Production build | PASS |

## Production probes (no genuine payment)

| Probe | Result |
|-------|--------|
| health | 200 |
| free POST `{}` | 400 |
| unpaid monitoring-pass | 402 |
| malformed signature | 402 |
| config-readiness wrong bearer | 401 (owner secret live) |

- Code: `62e410e` · Proof: `47ade16`
- Deploy READY → `https://www.usenobu.xyz`
