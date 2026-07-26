# Lane 8R.3C.1 — ASP metadata alignment (BLOCKED)

**Status:** `NOBU_LANE_8R_3C_1_BLOCKED_UPDATE_REFUSED`
**Date:** 2026-07-26
**Base commit:** `cc320d5` (`cc320d554a44cd33b82e59816d3e2d4b43c8ded2`)

The single authorized `agent update` against ASP `#5541` was attempted **exactly
once** and was **refused by the Onchain OS CLI's own local preflight gate before
it executed**. No on-chain write occurred. ASP `#5541` is unchanged.

## Outcome in one line

The blocker is the **local A2A environment**, not the payload, not the production
endpoints, and not ASP `#5541`.

## Preflight (all read-only, run before the attempt)

| Check | Result |
|---|---|
| HEAD is exactly `cc320d5` | **PASS** — `cc320d554a44cd33b82e59816d3e2d4b43c8ded2` |
| Tracked worktree and index clean | **PASS** — `git status --porcelain -uno` empty, branch `master` |
| No unknown prior shell / Onchain OS process | **PASS with disclosure** — see below |
| Production free endpoint `200 READY` | **PASS** — `200`, `agent_state: SERVICE_DESCRIPTOR`, `status: READY`, `Nobu Purchase Setup`, 1.12 s |
| Production `/v1/agent/monitoring-pass` valid `402` | **PASS** — `402` + `Payment-Required`; `x402Version 2`, `exact`, `eip155:196`, USD₮0, `990000`, `maxTimeoutSeconds 300`, `extra{name: USD₮0, version: 2}`, 0.84 s |
| Payload byte-identical to 8R.3C.0 | **PASS** — both descriptions byte-identical to the operator runbook; sha256 `deb1edb0…99c0d`, 1167 bytes, 2 elements, both `operation: "update"` |
| ASP `#5541` drift since 8R.3C.0 | **PASS** — none; `approvalDisplayStatus 5`, `33561` correct, `35958` still stale |

**Process disclosure.** One Onchain OS process was active: the official OKX A2A
daemon, PID `19332`, `@okxweb3/a2a-node@0.1.9`, started 2026-07-23 13:10:26,
orphaned from an exited parent shell. It was **identified, not unknown** — the
same documented daemon present during Lanes 8R.3A, 8R.3B, 8R.3B.1 and the
8R.3C.0 preflight. This was escalated rather than silently interpreted, and the
governing operator decision was to treat it as known and **not** kill or restart
it. Full attestation: `daemon-attestation.json`.

## The attempt

One invocation, one payload, no retry:

```
onchainos agent update --agent-id 5541 --service '<validated 8R.3C.0 payload>'
```

Result — the CLI refused before executing:

```
[onchainos] checking A2A communication readiness (okx-a2a doctor)...
[onchainos] A2A communication is NOT ready: 1 issue(s) found; all are auto-fixable.
{"ok":false,"error":"A2A communication is not ready, so this operation was not executed. …
- Upgrade to @okxweb3/a2a-node@latest and restart the daemon on the new version.
  (run: npm install -g @okxweb3/a2a-node@latest)
Run `okx-a2a doctor --fix` to repair the local A2A environment, then retry."}
```

Full capture, including the exit-code honesty note: `agent-update-attempt.json`.
Classification: `refusal-classification.md`.

## Read-back — no state change

Every QA-governed field is byte-for-byte unchanged:

| Field | State |
|---|---|
| Agent ID | `5541` — unchanged; no `newAgentId`; no second ASP |
| Service ids | `33561`, `35958` — unchanged; total still 2; none created or deleted |
| `33561` name / fee / endpoint | `Nobu Purchase Setup` / `0` / `/v1/agent` — unchanged |
| `33561` description | **Original text** — the new description was never applied |
| `35958` name | `Nobu Monitoring Activation` — **not** renamed to `Nobu Monitoring Pass` |
| `35958` endpoint | `/v1/agent/start-monitoring` — **still stale** |
| `35958` fee | `0.99` — unchanged |
| `35958` description | **Original text** — never applied |
| QA status | `approvalDisplayStatus 5` / "Listing rejected", `approvalStatus 6`, `statusLabel not listed` — unchanged; QA **not** re-triggered |

The only fields that moved are `lastOnlineTime` / `updatedAt`, which track each
other to within 0–2 ms across three samples and kept advancing while no further
update was attempted — the known ~60 s daemon heartbeat, not a write from the
refused call. Disclosed explicitly in `asp-readback-after-refusal.json` so the
no-state-change claim is auditable.

## Hard-lock compliance

| Lock | Status |
|---|---|
| `agent update` executed | **Not executed** — attempted once, refused by local gate before any write |
| Second `agent update` / retry | **Held** — none |
| `agent activate` / resubmission | **Held** — none |
| Genuine or test payment | **Held** — none |
| User-role identity registration | **Held** — none |
| OKX.ai User prompt sent | **Held** — not sent |
| Second ASP or new service id | **Held** — none; payload used `update` only, and was never transmitted |
| Production code altered or deployed | **Held** — none |
| Approval or public listing claimed | **Held** — `#5541` remains rejected / not listed |
| A2A daemon killed, restarted or upgraded | **Held** — untouched, per operator decision |
| Alternative payload guessed | **Held** — none constructed |

## What remains blocked

Lane 8R.3C Step 1 is still outstanding. Service `35958` still advertises
`/v1/agent/start-monitoring`, which OKX's own `x402-check` reports `valid: false`
(`HTTP 405`), while the repaired `/v1/agent/monitoring-pass` — validated
`valid: true` — remains unregistered. Lane 7.4G stays blocked behind it.

Because the update never ran, the downstream immediate-proof steps (designated
routing, official `x402-check` against the *updated* listing, QA-status capture
after the update) were correctly **not** performed — there is no updated listing
to validate. The `x402-check` results from Lane 8R.3C.0 remain the current truth.

## Unblocking requires a new operator decision

The CLI's remedy is to upgrade `@okxweb3/a2a-node` to latest and restart the
daemon on the new version — which directly contradicts this lane's instruction to
leave the daemon running. Options are recorded, unexecuted and unrecommended, in
`refusal-classification.md`.

## Evidence index

| File | Contents |
|---|---|
| `agent-update-attempt.json` | Exact command, argv, payload hash, verbatim stdout/stderr, full `"ok": false` object, exit-code honesty note |
| `asp-readback-after-refusal.json` | Post-refusal `#5541` + both services, field-by-field diff, heartbeat-timestamp disclosure |
| `daemon-attestation.json` | A2A daemon attestation (PID, version, start time, uniqueness, no children) and other observed processes |
| `refusal-classification.md` | Where the refusal came from, why nothing was transmitted, and the recorded operator options |
