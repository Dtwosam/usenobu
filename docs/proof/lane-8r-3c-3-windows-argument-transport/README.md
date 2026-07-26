# Lane 8R.3C.3 — Windows `--service` argument transport proof (BLOCKED)

**Verdict:** `NOBU_LANE_8R_3C_3_BLOCKED_ARGUMENT_TRANSPORT`

**Date:** 2026-07-26

**Base commit:** `0fecf578a125b3ad843fa539a36ad2d3c9c4fccf`

## Outcome

The prescribed read-only transport proof did not meet the success criterion.
Node.js invoked the selected Onchain OS `4.4.0` executable with
`child_process.spawnSync`, `shell: false`, and an explicit ten-element argument
array. The exact Lane 8R.3C.0 payload was loaded inside Node and supplied once,
as the value immediately following `--service`; it was never interpolated into
a PowerShell command string.

Immediately before spawn, the payload was still 1167 UTF-8 bytes with SHA-256
`deb1edb05368aa092a1d110927709d36317bbe0f2f8723416fb0b1f3be499c0d`,
with exactly two entries: `update:33561` and `update:35958`. Both service
descriptions were byte-identical to the operator runbook.

The process exited `0` and emitted no stderr, but stdout contained
`pass: false` with one blocking finding:

```text
field: service
code: PARSE
issue: --service is not a valid JSON array of service objects.
```

The earlier `key must be a string` error did not recur, but a `PARSE` finding
did. Therefore this lane cannot prove that the explicit argument-array method
delivers the canonical payload intact to the Onchain OS service parser. No
second transport method or second validation invocation was attempted.

## Preconditions

- Repository HEAD matched the exact base; `master`, worktree, and index were
  clean.
- First-resolved executable:
  `C:\Users\dtwof\.local\bin\onchainos.exe`, version `4.4.0`.
- Onchain OS preflight: integrity `ok`, stable/current `4.4.0`, `updated:
  false`. Its instruction-bundle maintenance recommendation was not executed
  because this lane is read-only.
- Official unrestricted A2A doctor: `ready: true`, zero blocking failures,
  package `0.1.10`, daemon PID `27124`, identity refresh `changed: false`.
- ASP `#5541` and services `33561`/`35958` matched the Lane 8R.3C.2 baseline.

The first doctor invocation was attempted inside the restricted workspace
sandbox and produced only sandbox-specific `EPERM`/read-only-database failures.
It made no repair. The same official native doctor was then rerun read-only
outside that sandbox and passed fully; only the passing result is authoritative
for A2A readiness.

## Onchain OS inspection

The installed `4.4.0` help states:

- `agent validate-listing` is pure-local and performs no network request;
- its `--service` accepts a JSON array string with the same element shape as
  create/update;
- `agent update --service` accepts incremental service changes.

Read-only binary-string inspection found the installed validator's
`PARSE`, `failed to parse --service as JSON array`, and
`key must be a string` diagnostics. No source modification or reverse
engineering patch was attempted.

## Post-attempt readback

| Field | Result |
|---|---|
| Agent | `5541`, `Nobu`, ASP, online `1` — unchanged |
| QA | `approvalDisplayStatus 5`, `approvalStatus 6`, `not listed` — unchanged |
| Services | Exactly `33561` and `35958`; none created or deleted |
| `33561` | `Nobu Purchase Setup`, fee `0`, `/v1/agent`, original description |
| `35958` | `Nobu Monitoring Activation`, fee `0.99`, `/v1/agent/start-monitoring`, original description |

Only heartbeat timestamps advanced. No QA-governed field changed and QA was
not retriggered.

## Hard-lock attestation

- `agent update`: not run.
- `agent activate`, payment, User registration, deployment, resubmission: not
  run.
- ASP/service mutation: none.
- A2A package or daemon change: none.
- Validated payload alteration: none.
- Additional transport method or validation attempt: none.

## Evidence

- `preflight.json` — repository, CLI, and A2A readiness baseline.
- `onchainos-parser-inspection.txt` — redacted installed-help/parser findings.
- `payload-integrity.json` — canonical payload bytes, digest, entries, and
  runbook equality.
- `spawn-sync-transport-proof.json` — exact executable, argument metadata,
  exit code, stdout/stderr, and parser classification.
- `asp-readback.json` — redacted before/after ASP, services, and QA comparison.

## Exact next action

Lane 8R.3C.3 is blocked. A new, explicitly authorized read-only operator lane
must determine from the official Onchain OS `4.4.0` implementation whether the
`PARSE` finding is caused by Windows argv transport or by the validator's
accepted service-object schema. It must not alter the canonical payload or run
an ASP write. No update authorization exists.
