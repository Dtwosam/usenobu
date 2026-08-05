# Paid → Free machine continuation repair

**Date:** 2026-08-05  
**Baseline:** `6e56e07`  
**Verdict:** `NOBU_PAID_TO_FREE_MACHINE_CONTINUATION_PASS` (local contract proof + Production unpaid probes)

## Defects repaired

1. **Incomplete continuation contract** — after a genuine Monitoring Pass payment, Nobu exposed internal values (`connection_token`, `connection_id`, `discovery_session_id`) without a complete machine-resumable contract, so buyer agents asked the user for tokens/IDs.
2. **Obsolete free endpoint** — catalogue default pointed at the obsolete Vercel-generated alias instead of sole Production domain `https://www.usenobu.xyz`.

Live payment used for diagnosis only (not replayed):

- transaction: `0xe226d407e384264eda3d1191bf7eff36f52e0acddff95911bf2893a00529246c`
- pass: `pass_c390ac836fda4174b88bf44273e21f42`

## Canonical Production domain

Sole public domain:

```text
https://www.usenobu.xyz
```

| Service | Endpoint |
|---|---|
| Free Purchase Setup (33561) | `https://www.usenobu.xyz/v1/agent` |
| Paid Monitoring Pass (35958) | `https://www.usenobu.xyz/v1/agent/monitoring-pass` |

`DEFAULT_FREE_SERVICE_ENDPOINT` now matches the free path. Production `NOBU_FREE_SERVICE_ENDPOINT` is **unset**, so the corrected default applies. Repository `git grep usenobu.vercel.app` → zero matches (historical prose uses the obsolete-generated-alias wording or the canonical domain).

## Authoritative continuation: `protocol_continuation`

```ts
type ProtocolContinuation = {
  method: "POST";
  endpoint: string; // always https://www.usenobu.xyz/v1/agent
  service_id: 33561;
  body: Record<string, unknown>;
  merge_user_fields?: string[];
  sensitive_fields?: string[];
  do_not_ask_user: true;
  do_not_display: true;
};
```

- `protocol_continuation` is authoritative.
- `machine_continuation` mirrors it identically (temporary compatibility).
- Machine-owned names never appear in `required_fields` / `fields` / `requiredArgs`.
- Missing internal state → `INTERNAL_CONTINUATION_STATE_MISSING` (no payment, no credential ask).

## Paid issuance response

After confirmed settlement:

- `status: MONITORING_PASS_ISSUED`
- `payment_status: recognized`
- `automatic_continue: true`, `input_required: false`
- `protocol_continuation.body` carries `pass_continuation_id` + `pass_claim_credential` only
- `pass_claim_credential` is **not** top-level and never in human text/logs
- Atomic claim + journey on free service; next human field is only `confirm_use_pass`

## Stage contract (user fields only)

| Stage | User fields | Continuation body |
|---|---|---|
| confirm_use_pass | `confirm_use_pass` | `journey_id` |
| purchase_description | `purchase_description` | `journey_id` |
| product_discovery | _(none, automatic)_ | `journey_id` |
| candidate_id | `candidate_id` | `journey_id` |
| email | `email` | `journey_id` |
| verification_code | `verification_code` | `journey_id` |
| consents | `monitoring_consent`, `email_alert_consent` | `journey_id` + `connection_token` |
| ACTIVATION_PENDING | _(none, automatic)_ | `journey_id` + `connection_token` |

## Generic buyer-agent A-to-Z proof

Focused test: `tests/a2mcp/generic-buyer-agent-continuation.test.ts`

Agent knows only: `required_fields`, `input_required`, `automatic_continue`, `protocol_continuation`.

Proved:

- one mocked payment → one pass → one continuation → one journey
- human sequence: `confirm_use_pass` → `purchase_description` → `candidate_id` → `email` → `verification_code` → consents
- one discovery lifecycle, one candidate confirm, one email verification connection, one pass redemption, one monitoring activation
- no second-payment challenge; no machine-owned required fields; no obsolete hostname in serialized responses
- paid continuation replay recovers the same journey
- concurrent claim followers → one durable journey
- public IDs alone cannot claim
- `ACTIVATION_PENDING` continuation includes `connection_token`
- secrets stay out of human-facing surfaces

## Focused gates

| Gate | Result |
|---|---|
| generic A-to-Z + A2MCP marketplace/contract/catalogue | 37/37 |
| monitoring-pass + claim + start-monitoring + free validation | 65/65 |
| typecheck | clean |
| `next build` | clean |
| `git diff --check` | clean |
| obsolete-hostname grep | zero matches |
| secret scan (narrow) | no raw claim/token console leaks |

## Production probes (unpaid only)

After deploy of this commit to `https://www.usenobu.xyz` only:

| Probe | Expected |
|---|---|
| `GET /health` | 200 |
| free first contact `POST /v1/agent` `{}` | 400 SERVICE_SELECTION_REQUIRED; endpoints use `www.usenobu.xyz` |
| unpaid paid endpoint | 402 x402 challenge |
| malformed payment signature | 402 reject / re-challenge |
| serialized domain checks | no obsolete generated alias hostname |

No genuine payment, no ASP `#5541` mutation, no service metadata edit.

## Live journey recovery assessment

Existing paid buyer-agent state for pass `pass_c390ac836fda4174b88bf44273e21f42`:

```text
EXISTING_LIVE_JOURNEY_RECOVERY_REQUIRED
```

Reason: pre-repair issuance did not expose a complete `protocol_continuation` with single-use `pass_claim_credential` in a durable, agent-resumable form that a generic buyer can re-read from Nobu responses alone. Public pass/continuation IDs cannot claim. Operator recovery (reconcile / re-issue claim credential for that continuation without a second charge) is outside this unpaid-probe lane. Do not ask the user for internal tokens. Do not initiate another payment.

## Changed surface (code)

- `src/a2mcp/protocol-continuation.ts` (new)
- `src/a2mcp/conversation-contract.ts`
- `src/a2mcp/marketplace-journey.ts`
- `src/a2mcp/service-catalogue.ts`
- `src/a2mcp/request-log.ts`
- `src/payments/monitoring-pass-service.ts`
- `src/payments/start-monitoring-response.ts`
- `app/v1/agent/start-monitoring/route.ts`
- OpenAPI free/paid servers → sole Production domain
- Focused tests including generic buyer A-to-Z
