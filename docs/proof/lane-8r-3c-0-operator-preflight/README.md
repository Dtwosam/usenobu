# Lane 8R.3C.0 — Operator preflight (read-only)

**Status:** `NOBU_LANE_8R_3C_0_READY_FOR_OPERATOR_DECISION`
**Date:** 2026-07-26
**Scope:** read-only inspection and payload validation only. No `agent update`,
`agent activate`, payment, User-role registration, or resubmission was run.

This lane exists to reduce Lane 8R.3C Step 1 (the operator's `agent update`
call) to a reviewed, pre-validated action instead of a first-time blind call.

## 1. `agent update` behaviour, and whether it retriggers review

Inspected via the installed official Onchain OS CLI's own `--help` schema
(`agent update --help`, `agent --help`) — no state-changing flag used.

- `--service` takes an **incremental** JSON array: only elements you include
  are created/updated/deleted; omitted services are left untouched.
- `--agent-id` is required and fixed — `agent update` cannot create a new
  agent or change service ids.
- The CLI's own `activate` command description states plainly: *"QA runs at
  register/update, not here."* That means the planned `--service` update is
  expected to **re-trigger OKX's marketplace QA/review** on `#5541` by
  itself; a separate `agent activate` is neither required nor planned to
  cause that review (and the operator runbook already forbids calling
  `agent activate` in the same step).

Full captured text: `agent-update-help.txt`.

## 2. ASP `#5541` and both services, read back

`onchainos agent get-agents --agent-ids 5541` and
`onchainos agent service-list --agent-id 5541`, both read-only.

Result is **byte-for-byte consistent** with `docs/nobu-current-state.md`'s
existing ASP status table: `approvalDisplayStatus: 5` ("Listing rejected"),
service `33561` correctly at `/v1/agent`, service `35958` still stale at
`/v1/agent/start-monitoring`. No drift since Lane 8R.3B. Full data:
`asp-readback.json`.

## 3. Proposed two-service update payload, validated but not executed

The exact `--service` JSON array described in the operator runbook
(`docs/proof/lane-8r-3b-monitoring-pass-repair/operator-runbook.md`, Step 1)
was written out and validated for JSON syntax and schema-field correctness
against the CLI's own documented element keys (`serviceName`,
`serviceDescription`, `serviceType`, `fee`, `endpoint`, `operation`, `id`).
Both elements use `operation: "update"` against the existing service ids —
no `create`/`delete`, so no new service id and no second ASP. The payload
was **not** passed to `onchainos agent update` at any point in this lane.
Full payload and a diff against the currently-registered values:
`proposed-service-update.json`.

## 4. Production endpoints, re-verified

Direct `curl` against both live routes and a fresh official
`agent x402-check` against both the new and the still-registered endpoint —
all read-only GET/POST probes with no payment, no quote, no connection.
Results are unchanged from the Lane 8R.3B production proof: free `200`
descriptor, paid `402` challenge, `x402-check valid: true` for the repaired
endpoint and `valid: false` (`HTTP 405`) for the endpoint still registered
on `#5541`. Full data: `x402-check-and-endpoints.json`.

## 5. Expected state-changing effect of the update (reported, not performed)

One on-chain metadata write to agent `#5541`, covering both services in a
single call:

- agent id and both service ids (`33561`, `35958`) unchanged;
- service `35958`'s name, fee-unchanged, endpoint, and description change to
  point at the already-repaired `/v1/agent/monitoring-pass`;
- service `33561`'s description changes to mention Monitoring Pass
  redemption (name, fee, endpoint unchanged);
- costs gas on the configured wallet;
- re-triggers OKX marketplace QA/review, moving `approvalDisplayStatus` off
  `5` ("Listing rejected") into a new pending-review state, per §1 above;
- does **not** itself call `agent activate`, submit payment, register a
  User-role identity, or resubmit — those remain separate operator steps
  (2 onward) in the runbook.

## Hard-lock compliance

| Lock | Status |
|---|---|
| No `agent update` executed | Held |
| No `agent activate` / resubmission | Held |
| No genuine or test payment | Held |
| No User-role registration | Held |
| No second ASP, no new service id | Held — payload uses `update` only against existing ids |
| No secrets logged | Held — `payTo` masked; no private key, token, or signature touched |

## What this unblocks

Lane 8R.3C Step 1 ("Execute the single ASP metadata update") can now be run
by the operator against a payload that has already been schema-validated and
diffed against the live registration, with the exact expected effect
reported above. **Executing it remains an explicit, separate operator
decision** — nothing in this lane authorizes it.

## Evidence index

| File | Contents |
|---|---|
| `agent-update-help.txt` | Captured `agent update --help` / `agent --help` excerpt and the QA-retrigger inference |
| `asp-readback.json` | Current `#5541` + both services, read-only |
| `proposed-service-update.json` | Validated (not executed) `--service` payload + diff vs. live registration |
| `x402-check-and-endpoints.json` | Re-verified production free/paid endpoints + official `x402-check` |
