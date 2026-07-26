# Lane 8R.3C.2 — A2A repair and ASP alignment (BLOCKED)

**Verdict:** `NOBU_LANE_8R_3C_2_BLOCKED_UPDATE_REFUSED`

**Date:** 2026-07-26

**Resume base:** `c3f2ccac17f457733e2a4c1f4bc3981ba2a4e4ee`

## Outcome

The manually repaired Windows Onchain OS installation passed the resumed
preflight: `.local\bin\onchainos.exe` resolved first, reported version `4.4.0`,
and the old `4.2.4` executable remained untouched in second position. ASP
`#5541`, services `33561`/`35958`, and the production endpoints were unchanged.

The authorized local A2A repair succeeded. The single known daemon running
`@okxweb3/a2a-node@0.1.9` was stopped, the package was upgraded to stable
`0.1.10`, and exactly one replacement daemon was started with the existing Nobu
configuration and provider `codex`. The final official doctor result was
`ready: true` with zero blocking failures and no warnings. The one optional
autostart item was deliberately left unchanged.

After operator confirmation, exactly one `agent update` invocation used the
exact Lane 8R.3C.0 payload (1167 bytes, SHA-256
`deb1edb05368aa092a1d110927709d36317bbe0f2f8723416fb0b1f3be499c0d`).
The active Windows CLI refused it while parsing the `--service` argument:
`failed to parse --service as JSON array: key must be a string at line 1 column
3`. The command exited before a backend write. Per the one-attempt and
stop-on-first-material-failure locks, it was not retried or altered.

## Immediate read-back

| Field | Result |
|---|---|
| Agent | `5541`, ASP, online `1` — unchanged |
| QA | `approvalDisplayStatus 5`, `approvalStatus 6`, `not listed` — unchanged; review not retriggered |
| Services | Exactly two: `33561`, `35958`; none created or deleted |
| `33561` | `Nobu Purchase Setup`, fee `0`, `/v1/agent`, original description — unchanged |
| `35958` | `Nobu Monitoring Activation`, fee `0.99`, `/v1/agent/start-monitoring`, original description — unchanged |
| Official x402 check | `/v1/agent/monitoring-pass`: `valid: true`, x402 v2, exact, `eip155:196`, `990000` minimal units |

No QA-governed ASP field changed. Service `35958` was not renamed or repointed,
and QA was not retriggered. The official x402 check proves the intended paid
endpoint remains valid, but it is still not the endpoint registered on service
`35958`.

## State-change attestation

- A2A package upgrade: one, `0.1.9` to `0.1.10`.
- Daemon stop: only old PID `19332`.
- Daemon restart: exactly one new daemon, PID `27124`.
- ASP update invocations: exactly one; refused during local argument parsing.
- Additional/alternative update, activation, resubmission, payment, User-role
  registration, production-code change, or deployment: none.

The full payment address and all credentials are omitted. Recorded launch
configuration contains no secrets.

## Evidence

- `preflight-results.json` — historical first-run blocker, superseded by the
  manually repaired CLI and resumed preflight.
- `a2a-repair.json` — redacted before/after package, daemon, and doctor state.
- `asp-update-attempt.json` — exact payload provenance, digest, invocation
  count, and refusal.
- `asp-readback-and-x402.json` — immediate field-by-field ASP read-back and
  redacted official x402-check result.

## Exact next action

Lane 8R.3C.2 is blocked with no update authorization remaining. Before any
future ASP write, a new operator-controlled lane must determine the documented
Windows argument-transport form accepted by Onchain OS `4.4.0`, validate it
without mutating ASP state, and explicitly authorize a new single attempt. Do
not infer authorization to retry this lane.
