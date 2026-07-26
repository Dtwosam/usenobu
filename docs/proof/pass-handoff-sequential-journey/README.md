# Monitoring Pass handoff and sequential journey

**Date:** 2026-07-26  
**Verdict:** `NOBU_PASS_HANDOFF_AND_SEQUENTIAL_JOURNEY_PASS`  
**Baseline:** clean descendant of `fc81bc0` / `c3b141e` → code commit `8195541`

## Audit findings (before code)

| Question | Finding |
|---|---|
| Identifiers available to Nobu on paid replay | `PAYMENT-SIGNATURE` header only (stored as sha256 digest). No OKX task id, job id, or wallet is persisted on the Monitoring Pass path. Resource URL is server-built. |
| Official task follow-up / replace deliverable | Installed Onchain OS 4.4.0 has job `next_action` event strings for evaluator/user/provider, not a documented ASP API to rewrite a completed marketplace deliverable. Not used. |
| OKX field collector consumable names | Binary contains `inputRequired`, `requiredArgs`, `fields`, `status: input_required`, and guidance to check `replayBody` for those. **`required_user_input` is not present** in the binary. |
| Why email was requested early | Stale marketplace deliverable was `PAYMENT_SETTLEMENT_PENDING` with no pass handoff; the calling agent invented steps and over-read free `supported_actions` (including email). Purchase Setup itself only requires `purchase_text` for `UNDERSTAND_PURCHASE`. |
| Redemption credential | Public `monitoring_pass_id` only; no pass token. Redeem still needs connection + quote + eligibility + consents. |
| Production scheduler / CRON | Route `POST /v1/owner/monitor-scheduler` exists; uses Bearer `CRON_SECRET`. Secret was rotated during live recovery (Sensitive; not pullable). No Vercel cron config in-repo — caller must use the rotated secret from the dashboard. |
| Email readiness | Production lists `RESEND_API_KEY` / `EMAIL_FROM_ADDRESS` (Sensitive values not printed). Health reports store ok; verification codes use Resend-backed path when configured. |

## Root cause

1. Marketplace saved a terminal pending deliverable with **no continuation handle**.  
2. Recovery issued the pass server-side, but the OKX.ai User-role path only saw the stale pending body.  
3. Nobu journey fields used nested `required_user_input`; official tooling demonstrably consumes top-level **`fields` / `requiredArgs`**.

## Handoff mechanism selected

**Free action `RESOLVE_MONITORING_PASS`** with high-entropy `pass_continuation_id` (and optional public `monitoring_pass_id` for historical recovery).

Why: no official completed-task rewrite; continuation is durable, not a payment header, not a redeem bearer, and works after marketplace job completion.

## Current-pass backfill

Production resolve of `pass_8dd13c79ce1842aa89f91609527764f4` returned:

- `status: MONITORING_PASS_ISSUED`
- `monitoring_active: false`
- `pass_continuation_id: pass_cont_be5817c0b7a249ad87b6a931e2279718`
- `second_payment_required: false`
- message: “Your Monitoring Pass is ready…”
- `next_action: UNDERSTAND_PURCHASE` with `fields`/`requiredArgs: ["action","purchase_text"]`

Exactly one continuation row was created for the historical payment.

## Focused checks

| Check | Result |
|---|---|
| `tests/payments/monitoring-pass.test.ts` | 25/25 |
| `tests/a2mcp/free-agent-validation.test.ts` | 5/5 |
| `tests/payments/start-monitoring.test.ts` | 9/9 |
| Typecheck | pass |

## Deployment

| Item | Value |
|---|---|
| Deploy | `dpl_GgroyZbmnevwrTngsG3qjfFLKmHL` |
| URL | `usenobu-j88uthvd1-dtwoflicks-2878s-projects.vercel.app` |
| Alias | `https://usenobu.vercel.app` explicitly pointed |
| Health | 200 ok |
| Free GET | 400 `input_required` |
| Paid GET | 402 `PAYMENT_PENDING` |
| Resolve historical pass | 200 issued, inactive |

## Exact User-role test start

1. `I would like to use the services of agent ID 5541`  
2. If paid deliverable is stale: free `RESOLVE_MONITORING_PASS` with  
   `monitoring_pass_id: pass_8dd13c79ce1842aa89f91609527764f4`  
   (or the `pass_continuation_id` above).  
3. Confirm user wants to use the pass.  
4. `UNDERSTAND_PURCHASE` with purchase description only.  
5. Continue sequential: discover → confirm → email → code → both consents + preflight → redeem same pass id.  
6. Never pay again.

## ASP metadata

No update executed. Optional later operator candidate: free service description may mention `RESOLVE_MONITORING_PASS` for post-payment handoff. Not required for code path to work.
