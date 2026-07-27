# Marketplace journey live repair — reconciliation blocked

**Date:** 2026-07-27
**Starting HEAD:** `139dad3b33edcd0d07716f009a729764b6e7564e`
**Canonical application commit:** `139dad3b33edcd0d07716f009a729764b6e7564e`
**Canonical Production deployment:** `dpl_BE7Ki6KGMEhdpSsxo4pUSYewJBAd`
**Canonical deployment host:** `usenobu-cf3hbavti-dtwoflicks-2878s-projects.vercel.app`
**Verdict:** `NOBU_MARKETPLACE_JOURNEY_BLOCKED_MULTIPLE_PENDING_SETTLEMENTS`

## Pre-mutation proof

- Tracked worktree and index were clean at exact HEAD `139dad3`.
- `usenobu.vercel.app` resolved to READY deployment `dpl_G1pxk6qa5YySUradbSXikbjHKPEG` before mutation.
- That deployment was created by the recorded clean local CLI deployment at HEAD `139dad3`; Vercel inspect exposed no separate Git metadata field.
- The earlier code commit `0c0acf1` and intermediate deployment `dpl_GCzb3QkYkAySjd1koyBQaumiiSpU` are implementation history, not canonical closeout references.

## Authorized Production recovery

A new 256-bit random `OWNER_OPS_SECRET` was generated in memory, set as a Sensitive Production value, and cleared from memory after use. It was never printed, committed, written to a file or returned. `CRON_SECRET` and unrelated configuration were untouched.

The exact unchanged application commit `139dad3` was redeployed once as `dpl_BE7Ki6KGMEhdpSsxo4pUSYewJBAd`; `usenobu.vercel.app` was explicitly re-aliased to that deployment.

Exactly two authenticated calls were made to `POST /v1/owner/pass-settlement-reconcile`:

| Call | HTTP | ok | scanned | issued | still pending | failed | continuations backfilled |
|---|---:|---:|---:|---:|---:|---:|---:|
| 1 | 200 | true | 2 | 2 | 0 | 0 | 0 |
| 2 | 200 | true | 0 | 0 | 0 | 0 | 0 |

Call 1 genuinely issued:

- `pass_d154602364564dd8b8b76540db54248b`
- `pass_1c299f2ee82e457eaa1da384ded38109`

Call 2 proves zero replay issuance. No payment authorization, signature, digest or settlement reference was exposed. No payment or paid task was created.

## Failure and stop decision

The lane expected at most one pending settlement for latest job `0x15a1f239…717f`. Production contained two pending records and reconciled both. The safe reconciliation response deliberately does not expose a job-to-payment mapping, so neither returned pass can be attributed to the specified job without guessing. The latest job's individual pass/state therefore remains **unmapped**, even though both recovered records are now non-pending and each issued one pass.

This is the first acceptance failure. Per the user's stop rule:

- no Onchain OS preflight command ran in this continuation;
- no deprecated global OKX package was removed;
- no free `Nobu Purchase Setup` task was created;
- no email, consent, redemption or monitoring activation occurred;
- ASP `#5541` and its services were not read or changed;
- `agent activate` was not executed.

The last proven ASP state remains rejected / not listed. No approval is claimed.

## Repair already deployed

The actionless durable Purchase Setup implementation remains deployed and previously passed its focused happy-path, safety and reconciliation tests, typecheck, Production build and safe endpoint probes. Existing-pass input remains free and starts at `confirm_use_pass`; no marketplace response exposes Nobu's internal action enum.

No new application code or code test was run in this continuation, as required.

## Exact next step

Open a new, explicitly authorized correlation lane. Use a read-only provider-controlled identifier already tied to job `0x15a1f239…717f`—preferably its known pass continuation—to map the job to one durable payment/pass without exposing settlement material. Account for the second legitimate settlement separately. Only after that mapping is proven may the deprecated-package preflight cleanup, exactly one free smoke and conditional existing-agent resubmission resume.
