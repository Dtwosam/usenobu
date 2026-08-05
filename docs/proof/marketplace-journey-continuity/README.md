# Marketplace journey continuity proof

**Date:** 2026-07-26
**Verdict:** `NOBU_MARKETPLACE_JOURNEY_CONTINUITY_PASS`
**Baseline:** clean `0088ea8c2b2344a0982c3cee6cb9f4799356bfad`

## Ownership

| Visible message | Owner | Evidence / treatment |
|---|---|---|
| Nobu introduction and service guidance | Nobu response + registered provider metadata; OKX controls final marketplace layout/order | Free response now places `introduction` before `service` and explains the full journey. ASP `#5541` was not edited. |
| Free-service “200/no payment” warning | Onchain OS, sometimes paraphrased by the calling AI | Installed `onchainos.exe 4.4.0` contains literal `Endpoint returned 200 — no payment required`; Nobu source does not. Safe mitigation: service `33561` says it is free and x402 does not apply. It remains `400 input_required` on empty validation and never returns `402`. |
| Payment confirmation | Onchain OS / Agentic Wallet payment layer | Nobu receives only the signed replay and returns its deliverable; no Nobu copy claims wallet settlement before seller verification/settlement succeeds. |
| Paid deliverable | Nobu `/v1/agent/monitoring-pass` | `MONITORING_PASS_ISSUED` plus non-active journey state and continuation to service `33561`. |
| Generic `Job Completed` | Onchain OS | Installed binary contains `[Job Completed]` and `[x402 Job Completed]`; Nobu source does not. Not provider-fixable. |
| Post-payment continuation | Nobu wire response; calling AI controls whether/how it presents it | Nobu now returns explicit continuation fields and guidance. Platform presentation remains external. |

## Provider-controlled behavior

- Free first contact introduces Nobu, says Purchase Setup is free and x402 does not apply, and returns all journey fields.
- The unpaid `$0.99` challenge explains that payment buys one Monitoring Pass only and monitoring does not start.
- Successful replay fixture:

```json
{
  "status": "MONITORING_PASS_ISSUED",
  "completed_step": "MONITORING_PASS_ISSUED",
  "monitoring_active": false,
  "journey_complete": false,
  "next_action": "UNDERSTAND_PURCHASE",
  "next_service_id": 33561,
  "required_purchase_input": [
    "purchase_text",
    "purchase_price",
    "purchase_date",
    "Target online product details"
  ]
}
```

- Free actions guide product details → exact user confirmation → email verification → both explicit consents → preflight → pass redemption.
- Only successful `REDEEM_MONITORING_PASS` normalizes the journey response to `MONITORING_ACTIVE`; pending/failed redemption stays inactive and incomplete.
- No pass token is returned or accepted. Full-entropy pass id + authorized connection + owned current quote + locked fingerprint + eligibility + both consents + atomic unused-pass consumption remain required.
- Settlement-ref uniqueness, replay/concurrency behavior and activation reconciliation remain exactly once.

## Focused checks

| Check | Result |
|---|---|
| `npx vitest run tests/a2mcp/free-agent-validation.test.ts` | 1 file, 5/5 passed |
| `npx vitest run tests/payments/monitoring-pass.test.ts` | 1 file, 20/20 passed |
| Focused continuation assertion | Paid response has required fields, no pass token, next service `33561` |
| Focused redemption assertion | Failed redemption inactive; successful redemption alone returns `MONITORING_ACTIVE`; exactly one activation |
| `npm run typecheck` | passed |
| Limited changed-file secret scan | no private-key, seed, live API-secret, raw response authorization/signature, or returned pass-token field found |
| `git diff --check` | passed |

No full suite or separate local production build was run. Vercel performed the required deployment build successfully.

## Deployment and bounded Production proof

- Deployment: `dpl_WJjvs2hQTfUzVSZqfXAKTrnUahvU`
- URL: `https://usenobu-4dqzxqa7s-dtwoflicks-2878s-projects.vercel.app`
- Canonical alias: `https://www.usenobu.xyz` explicitly updated
- State: `READY`
- Free probe (exactly one HTTP request): `GET /v1/agent` → `400 input_required`, introduction first, free/no-x402 message, inactive/incomplete journey, next action includes `UNDERSTAND_PURCHASE`.
- Unpaid paid probe (exactly one HTTP request): `GET /v1/agent/monitoring-pass` → x402 v2 `402`, `exact`, `eip155:196`, `990000`; body says pass only / monitoring not started and stays inactive/incomplete.

The first sandboxed curl process failed locally at Schannel before sending HTTP; the two successful requests above were then run outside that restricted token sandbox. No signed replay was sent.

## External limitation and next step

Onchain OS / the calling AI may still display `Endpoint returned 200 — no payment required`, payment confirmation, or generic job-completion wrappers. Nobu cannot remove or reorder those platform messages; its safe mitigation is the truthful machine-readable metadata now deployed.

No ASP edit, activation, resubmission, task creation, payment, paid replay, pass issuance or redemption occurred. ASP `#5541` remains rejected / not listed.

**Exact next live continuation step:** use free service `33561` action `UNDERSTAND_PURCHASE` with the user's recent Target online purchase description. Do not make another payment or redeem until exact product confirmation, email verification, both consents and preflight produce a current `MONITORING_PAYMENT_READY` quote.
