# Lane 8R.3C.4 — Onchain OS 4.4.0 payload-schema repair proof

**Verdict:** `NOBU_LANE_8R_3C_4_READY_FOR_OPERATOR_DECISION`

**Date:** 2026-07-26

**Base commit:** `bda75526917929d150cb184ddf9eaaf8fd75859d`

## Outcome

One corrected service-update candidate was built for the official Onchain OS
`4.4.0` schema and passed the lane's single read-only validation. The exact
serialized candidate was 1162 UTF-8 bytes with SHA-256
`4926b9d2afb790a71d45b32ef0c81ae9114666bf9c9da40ea1fa1b64b9215fa9`.

Node.js invoked the selected executable with `child_process.spawnSync`,
`shell: false`, and an explicit ten-element argument array. The payload was
loaded from `corrected-payload-candidate.json`, checked against the recorded
byte count and hash immediately before spawn, and supplied once as argument
index 9. It was never interpolated into a PowerShell command string.

Validation exited `0` and returned:

```json
{
  "pass": true,
  "findings": []
}
```

There was no `service/PARSE` finding, no `key must be a string` error, no
stderr, and zero blocking findings. No second validation or alternative
transport method was attempted.

## Corrected schema

- Both entries retain `operation: "update"`.
- Existing service ids are strings: `"33561"` and `"35958"`.
- Both descriptions have three non-empty newline-separated sections:
  capability, user input, and delivery.
- Service type remains `A2MCP`.
- Fees remain `"0"` and `"0.99"`.
- Endpoints remain the intended `/v1/agent` and
  `/v1/agent/monitoring-pass` routes.
- Agent `5541` and exactly two existing services are preserved; this candidate
  does not create or delete a service.

The descriptions preserve the Target-only product truth and Target's final
decision boundary without URLs, test markers, outcome promises, or unsupported
capabilities.

## Official source finding

Official repository `okx/onchainos-skills`, tag `v4.4.0`, resolves to commit
`782b5a05d9b0af797383009b0e5f0d4022b010e5`.

- `identity/models.rs`: `AgentService.id` is `Option<String>` and
  `operation` accepts the lowercase create/update/delete enum.
- `identity/args.rs`: update ids are strings and service descriptions use
  newline-separated capability, user-input, and delivery sections.
- `identity/validate.rs`: `validate-listing` deserializes the same
  `AgentService` model as create/update; any model-deserialization failure is
  surfaced as `service/PARSE`. At least two non-empty description lines are
  required; a delivery line is recommended.
- `identity/utils.rs`: create/update parsing uses the same model and enforces
  update-operation/id consistency.

This proves Lane 8R.3C.3's `service/PARSE` was caused by the old payload's
schema, not by the Node explicit-array Windows transport.

## Preconditions and unchanged state

- Repository HEAD matched the exact base; branch, tracked worktree, and index
  were clean.
- Selected executable:
  `C:\Users\dtwof\.local\bin\onchainos.exe`, version `4.4.0`.
- Preflight: stable/current `4.4.0`, integrity `ok`, `updated: false`.
- A2A doctor: `ready: true`, zero blocking failures, package `0.1.10`,
  existing daemon PID `27124`, identity refresh unchanged.
- Before and after validation, ASP `5541` remained `Nobu`, online `1`,
  rejected/not listed (`approvalDisplayStatus 5`, `approvalStatus 6`).
- Services remained exactly `33561` and `35958`, with all registered names,
  descriptions, fees, endpoints, and service types unchanged. Only heartbeat
  timestamps advanced.

## Hard-lock attestation

- `agent update`: not run.
- `agent activate`, payment, User registration, deployment, resubmission: not
  run.
- ASP/service mutation: none.
- A2A package or daemon change: none.
- Additional validation or transport method: none.

## Evidence

- `preflight.json`
- `official-source-inspection.md`
- `corrected-payload-candidate.json`
- `local-candidate-proof.json`
- `validate-listing-proof.json`
- `asp-readback.json`

## Exact next lane

Lane 8R.3C.5 — separately authorized single corrected ASP metadata update and
immediate read-only proof. The exact Lane 8R.3C.4 candidate must be used
unchanged. No write authorization exists in this lane.
