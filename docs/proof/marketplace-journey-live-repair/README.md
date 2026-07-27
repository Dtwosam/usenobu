# Marketplace journey live repair — blocked closeout

**Date:** 2026-07-27
**Baseline:** `0756cb553e6944566f4d06dfe59bfce77c2fbfb0` (both `8195541` and `0756cb5` confirmed ancestors; clean index/worktree; no reset to `origin/master`)
**Repair commit:** `0c0acf1f7becfe15d2e96dde97f057514bccda44`
**Verdict:** `NOBU_COMPLETE_MARKETPLACE_JOURNEY_BLOCKED_REQUIRED_PRODUCTION_AND_OKX_APPROVALS`

## What was repaired

The live failure disproved the prior handoff PASS: marketplace callers were exposed to Nobu's internal `action` enum, Onchain OS guessed internal values, purchase/email/consent were bundled, and a paid job terminalized before free setup.

Nobu now owns a durable, actionless Purchase Setup journey keyed by a high-entropy `journey_id` and bound server-side to one issued pass, its continuation, stage, confirmed fingerprint, verified connection and owned quote. Incomplete marketplace responses contain exactly `status`, `journey_id`, `fields`, `requiredArgs` and `message`. Ordering is enforced: confirm pass → purchase description → discovery → exact candidate → email → code → both consents → provider preflight → provider redemption. Internal handles and payment material are never returned. Existing-pass calls to either the free or paid URL route into this free journey before x402, preventing another `402` or pass issuance.

Onchain OS 4.4.0 inspection established:

- a paid replay returning HTTP 200 is terminalized;
- a non-2xx response with `status: input_required` is continued and its `fields` / `requiredArgs` are collected;
- one paid job cannot officially transition itself into a separately registered free-service task;
- a free task can make repeated endpoint calls after successive `input_required` responses;
- `serviceParams` is natural-language input mapped semantically to declared endpoint fields;
- opaque returned values are not reliably replayed unless declared, so `journey_id` remains in `fields` / `requiredArgs` after the immediate customer field;
- custom `next_action` or nested guidance is not an executable handoff mechanism;
- the existing rejected ASP is resubmitted with `agent activate --agent-id 5541 --preferred-language en-US`, not by creating another agent.

Selected mechanism: after exactly-once pass issuance the paid replay returns `400 input_required` asking `confirm_use_pass`; all later calls are free and durable, including if Onchain OS replays the paid URL. This is the closest supported non-terminal mechanism. It is not claimed to create a separate free task automatically.

## Minimum checks

- Focused happy path: **PASS** — resolution through successful redemption / `MONITORING_ACTIVE`.
- Focused safety: **PASS** — actionless response shape; existing pass on paid URL returns 400 free input, never 402; no second payment/pass; early email/consent rejected.
- Focused reconciliation: **PASS** — one pass on confirmed settlement, zero on replay.
- `npm run typecheck`: **PASS**.
- Production build: **PASS** as part of Vercel deployment.
- Full suite, Playwright, broad scheduler/notification, genuine email, price-drop and duplicate-alert proofs: **not run**, as required.

## Deployment and safe probes

Deployment `dpl_GCzb3QkYkAySjd1koyBQaumiiSpU` (`usenobu-p8ex77jrb-dtwoflicks-2878s-projects.vercel.app`) is READY from exact clean commit `0c0acf1`. `usenobu.vercel.app` was explicitly re-aliased to it.

- `/health`: 200.
- Unpaid `/v1/agent/monitoring-pass`: 402 with `PAYMENT-REQUIRED` present.
- Existing issued pass `pass_8dd13c79…764f4`: 400 `input_required`; exact five-key body; fields `confirm_use_pass,journey_id`; no `action`; message says no additional payment.
- The malformed first attempt was a local PowerShell quoting error and returned `INVALID_JSON`; it performed no business operation. The stdin-JSON retry passed.
- No direct probe created a payment, pass, task, redemption, monitor, email or consent. The issued-pass probe created/reused only its durable journey.

## Latest genuine payment

Latest paid job `0x15a1f239…717f` remains unmodified. Local paid-job evidence says `PAYMENT_SETTLEMENT_PENDING` and exposes only a masked continuation; it contains no email or settlement secret. The provider-controlled production reconciliation route requires non-exportable `OWNER_OPS_SECRET` or `CRON_SECRET`. A proposed rotation of only `OWNER_OPS_SECRET`, same-commit redeploy and two idempotency calls was rejected by the safety reviewer because secret rotation can disrupt live owner tooling. It was not retried or bypassed.

Therefore this run does not claim settlement success, does not issue or name a new pass for the latest job, and does not claim the replay issued zero live passes. No new payment was made.

## Privacy finding

- Failed free task `0x828efd48…c550` is still non-terminal (`created`), so there is no terminal deliverable containing the email.
- Its local `designated-provider.json` contains no email.
- Local `~/.onchainos/audit.jsonl` contains the submitted real email once in the bundled confirmation action; the address is intentionally not repeated here.
- Backend task status/context readback did not expose parameters, so absence from the immutable backend parameter record is not proven. No rewrite was attempted.
- The paid deliverable/manifest contains no email.
- Nobu structured request logging records top-level key names only, never values. Production database inspection was not authorized in this run, so historical DB absence is not claimed.
- The repaired journey rejects email and consent before their stages, preventing future purchase-intake bundling through Nobu's marketplace contract.

## External blockers and exact next step

1. Explicitly approve a scoped Production `OWNER_OPS_SECRET` rotation, same-commit redeploy, and two calls to `/v1/owner/pass-settlement-reconcile` so the latest payment can be resolved truthfully and idempotency proven.
2. Explicitly approve the Onchain OS preflight-required removal of deprecated global OKX skill bundles. The safety reviewer rejected that global cleanup without direct approval.
3. After both gates clear, create exactly one free service `33561` smoke task using the recovered or existing issued pass; stop at the email request. Do not pay, redeem, send email or consent.
4. Only if that smoke passes, read ASP `#5541` and services, avoid metadata update if current copy remains accurate, then run the official `agent activate` resubmission and read back QA state.

No ASP metadata, activation or resubmission occurred in this run. Current QA remains the last proven state: rejected / not listed.