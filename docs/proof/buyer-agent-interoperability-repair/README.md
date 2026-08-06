# Buyer-agent interoperability repair

**Date:** 2026-08-06

**Baseline:** `1775ff1` → recovery `e7a485a` → claim-boundary final from `f52b537`

**Verdict:** `NOBU_BUYER_AGENT_INTEROPERABILITY_RECOVERY_FINAL_PASS`

## Live defects repaired (without mutating the active monitor)

Live successful payment used only as diagnosis evidence (not replayed/altered):

- transaction: `0x4c9919a39c0bb772ee76f9b9b33ffbdaca149d94c53b8d97fe47ef401512ade0`
- pass: `pass_ec936ecc6d76445c949c891adcea351e`

Observed buyer-agent conversation issues:

1. Buyer displayed `pass_claim_credential`
2. `do_not_ask_user` / `do_not_display` / imperative `guidance` looked like third-party prompt injection
3. Purchase Setup human stages returned HTTP 400 and were narrated as transport errors

## Compatibility audit (mandatory before HTTP status change)

### Official / installed client sources

| Source | Version / path | Use |
|---|---|---|
| Onchain OS CLI | `4.4.0` (`C:\Users\dtwof\.local\bin\onchainos.exe`) | Binary string extraction + prior lane proofs |
| OKX Agent Payments Protocol skill | `4.4.0` (`~/.agents/skills/okx-agent-payments-protocol`) | 402 → quote → pay → replay |
| OKX AI task user actions | `~/.agents/skills/okx-ai/references/task-user-actions-publish.md` | `inputRequired` field collection |
| Prior Nobu proof | Lane 8R.3C.6 free input validation | Official `agent x402-check` on free endpoint |

### Response-shape matrix (installed buyer client)

| Response shape | Continues field collection? | Treats job complete? | Treats call failed? | Preserves structured continuation? |
|---|---|---|---|---|
| **HTTP 400** + `status: "input_required"` / `fields` / `requiredArgs` | **Yes** for free-service x402-check classification (`inputRequired: true`) — proven Lane 8R.3C.6 | No | Not as transport failure for x402-check; **live marketplace multi-turn narrated 400 as transport error** | Yes when body fields present |
| **HTTP 200** + identical `input_required` body (`fields` / `requiredArgs` / `status: "input_required"`) | **Yes** — paid success path: CLI templates say after successful replay check `replayBody` for `requiredArgs` / `fields` / `status: "input_required"` then list Required fields | Only when deliverable is terminal without required fields | No | Yes (`replayBody` / `replayBodyDisplay`) |
| **HTTP 200** paid success followed by user-input continuation | **Yes** — same post-pay `replayBody` inspection | No while fields remain | No | Yes |
| **HTTP 200** automatic continuation (`automatic_continue: true`, empty fields) | N/A (auto POST) | Not until `MONITORING_ACTIVE` / terminal markers | No | Yes when `protocol_continuation` present |

### Binary evidence (Onchain OS 4.4.0)

Extracted strings include:

- `Endpoint returned 200 — no payment required` (x402 free classification; not a field-collection failure)
- `Check \`replayBody\` for \`requiredArgs\` / \`fields\` / \`status: "input_required"\`.`
- `Required: <list each field from replayBody>`
- `result == "input_required"` → collect business parameters
- Terminal wrappers: `[Job Completed]` / `[x402 Job Completed]` (platform-owned; not Nobu-authored)

### HTTP status decision

Because the installed client **demonstrably continues field collection on HTTP 200** after successful payment (and for free multi-turn stages 400 was live-misread as transport failure), marketplace journey **valid input-required and automatic stages** now return **HTTP 200**.

Isolated to `runMarketplaceJourney` incomplete/automatic stage responses. Unchanged:

- unpaid paid route → **402**
- settled success → **200**
- auth failure → **401**
- rate limit → **429**
- malformed JSON / structurally invalid free action bodies → **400**
- legacy free action-enum HTTP behavior outside marketplace journey → unchanged
- service selection first-contact remains **400** (catalogue selection, not journey stage)

If this matrix had been unproven, the lane would have returned `NOBU_BUYER_AGENT_INTEROPERABILITY_BLOCKED_HTTP_COMPATIBILITY_UNPROVEN` and kept 400 human stages.

## Code repair summary

### 1. Remove paid claim secret from new responses

- Settlement still exactly-once (one pass per settlement_ref).
- After issue: `ensureContinuation` + **`ensureMarketplacePurchaseJourney`** (idempotent, unique per `monitoring_pass_id`).
- Paid success returns only after pass + journey are readable.
- If journey ensure fails: `MONITORING_PASS_DELIVERY_PENDING` — payment/pass preserved, **no second charge**.
- Reconciliation backfills missing continuations **and journeys**.
- New public paid bodies contain **none** of `pass_claim_credential` / `claim_credential`.
- Historical continuations with `claim_credential_hash` still use secure claim recovery.

### 2. New paid handoff

```json
{
  "status": "MONITORING_PASS_ISSUED",
  "current_step": "confirm_use_pass",
  "payment_status": "recognized",
  "second_payment_required": false,
  "monitoring_active": false,
  "journey_complete": false,
  "input_required": true,
  "required_fields": ["confirm_use_pass"],
  "protocol_continuation": {
    "method": "POST",
    "endpoint": "https://www.usenobu.xyz/v1/agent",
    "service_id": 33561,
    "body": { "journey_id": "<durable journey id>" },
    "user_input_fields": ["confirm_use_pass"],
    "machine_fields": ["journey_id"],
    "sensitive_fields": []
  },
  "interaction": {
    "mode": "user_input",
    "fields": ["confirm_use_pass"],
    "confirmation_required": true
  }
}
```

- No secret-bearing automatic POST after payment.
- Buyer asks only whether to use the pass.
- Replay returns same pass + journey; never resets advanced stage; complete → `MONITORING_ACTIVE`.

### 3. Neutral public metadata

Removed from paid handoff + marketplace journey serialization:

- `do_not_ask_user`
- `do_not_display`
- imperative `guidance`

Replaced with typed `ProtocolContinuation` + `interaction`.

`machine_continuation` remains an identical mirror of `protocol_continuation`.

Legacy free-action guidance (service selection, free validation) left intact.

### 4. connection_token boundary preserved

- Generated only after email verification.
- Stored as hash server-side.
- Never top-level; only in continuation body under `sensitive_fields`.
- Never user-required; preserved through consent/preflight/activation retries.

## Focused proof

| Gate | Result |
|---|---|
| `tests/a2mcp/generic-buyer-agent-continuation.test.ts` | pass |
| marketplace journey + conversation contract + user-role + fallback | pass |
| monitoring-pass + claim/scheduler + paid-to-active audit/transaction | pass |
| Pre-existing unrelated: `agent-preflight` quote-issuance failure | fails at clean baseline `1775ff1` (out of scope) |
| typecheck | clean |
| production build | clean |
| `git diff --check` | clean |
| secret scan (claim/payment headers) | no new secrets in paid bodies |
| canonical domain | `https://www.usenobu.xyz` only |

## Hard boundaries respected

- No second genuine payment
- No ASP `#5541` / services `33561`/`35958` metadata edit
- No price/network/token/payTo change
- No email verification or connection_token auth model change
- No Target matching/policy/scheduler/alert logic change
- No website flow change
- Historical claim columns/recovery kept
- Live active monitor not mutated
- No noncanonical domain reintroduced

## Delivery-pending recovery repair (follow-up)

**Defect:** `MONITORING_PASS_DELIVERY_PENDING` could leave settled payment + issued pass + continuation with **no journey**. Reconciliation scanned only pending/orphan payments and missing-continuation rows, so a delivery-pending row with an existing continuation could remain stranded.

**Repair:**

1. `AuthStore.listSettledMonitoringPassPaymentsMissingJourney(limit?)` (SQLite + Postgres) — settled payments with issued/redeemed pass and no journey, **excluding** claim-hash continuations.
2. `reconcilePendingPassSettlements` processes that set independently; rechecks continuation before create; never auto-journeys when `claim_credential_hash IS NOT NULL`.
3. New continuations: `claim_credential_hash: null`. Historical claim recovery unchanged.
4. `ensureIssuedPassJourney` returns `{ journey, created }`; `journeys_backfilled` increments only when `created === true` (concurrent workers sum to 1).

**Focused proof:** `tests/payments/delivery-pending-journey-recovery.test.ts` (6/6).

## Historical claim boundary final (follow-up)

**Defect:** missing-journey query included historical unconsumed claim-hash rows; recon created journeys without credential validation, bypassing claim.

**Repair:** query + explicit reconcile guard exclude any continuation with non-null `claim_credential_hash` (consumed or unconsumed). Credential path remains the only creator for those rows. Concurrent `journeys_backfilled` uses proposed-id win detection.

## Production probes (unpaid only)

Initial deploy: `77751c9` / docs through `e7a485a` as `usenobu-h3ieqdska…` aliased to `https://www.usenobu.xyz`.

| Probe | Result |
|---|---|
| health | 200 ok |
| free `{}` | 400 SERVICE_SELECTION_REQUIRED |
| unpaid paid | 402 + PAYMENT-REQUIRED; no claim secret |
| malformed | 400 |
| live pass `pass_ec936ecc…` | 200 MONITORING_ACTIVE (unchanged) |

Recovery repair deploy notes: `production-probes.md` (updated after recovery deploy).
