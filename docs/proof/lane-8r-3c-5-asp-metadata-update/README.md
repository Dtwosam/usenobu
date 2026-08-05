# Lane 8R.3C.5 — Single corrected ASP metadata update

**Verdict:** `NOBU_LANE_8R_3C_5_BLOCKED_QA_NOT_RETRIGGERED`

**Date:** 2026-07-26

**Base commit:** `60a27b6ca82ca9ad3ab51504d6c98b5d715c3597`

## Outcome

Exactly one ASP metadata update was executed against agent `5541` using the
unchanged Lane 8R.3C.4 candidate loaded directly from:

`docs/proof/lane-8r-3c-4-payload-schema-repair/corrected-payload-candidate.json`

The payload was guarded immediately before execution at 1162 UTF-8 bytes and
SHA-256:

`4926b9d2afb790a71d45b32ef0c81ae9114666bf9c9da40ea1fa1b64b9215fa9`

Node.js invoked the selected executable with `child_process.spawnSync`,
`shell: false`, and an explicit six-element argument array. The update exited
`0`, returned `newAgentId: null`, and recorded transaction:

`0xea8dbdaf7d2f821e0638ff1f5da809d571619016ad36adf3872392a5a3cec45b`

No retry, second update, alternative payload, or manual payload reconstruction
was attempted.

## Metadata readback

Immediate readback proved the expected metadata was written completely:

- agent remains `5541` (`Nobu`);
- exactly two services remain;
- service ids remain `33561` and `35958`;
- service `33561` remains `Nobu Purchase Setup`, fee `0`, endpoint
  `https://www.usenobu.xyz/v1/agent`;
- service `33561` has the exact Lane 8R.3C.4 multiline description;
- service `35958` is now `Nobu Monitoring Pass`, fee `0.99`, endpoint
  `https://www.usenobu.xyz/v1/agent/monitoring-pass`;
- service `35958` has the exact Lane 8R.3C.4 multiline description;
- no agent or service id was created, deleted, or replaced.

## QA result

QA did **not** retrigger. The immediate readback remained:

- `approvalDisplayStatus: 5`
- `approvalLabel: "Listing rejected"`
- `approvalStatus: 6`
- `statusLabel: "not listed"`
- the prior platform-timeout rejection remark remained unchanged.

The metadata update itself succeeded, but the lane cannot return
`NOBU_LANE_8R_3C_5_PENDING_QA` because the required QA/review transition did
not occur. The locked outcome is therefore:

`NOBU_LANE_8R_3C_5_BLOCKED_QA_NOT_RETRIGGERED`

No activation or separate resubmission was attempted.

## Read-only routing and x402 proof

Designated routing for provider `5541` resolved online with both corrected
services and the new Monitoring Pass endpoint.

The official read-only x402 validator returned `valid: true` twice:

- without a body;
- with `{}`.

Both results reported x402 version `2`, scheme `exact`, network
`eip155:196`, amount `990000` minimal units (`0.99`), and the expected
USD₮0 asset.

## Preconditions

- repository HEAD matched the exact base commit;
- tracked worktree and index were clean;
- selected executable:
  `C:\Users\dtwof\.local\bin\onchainos.exe`;
- Onchain OS version `4.4.0`;
- required instruction-bundle preflight maintenance completed; the active
  bundles then reported `4.4.0`;
- official A2A doctor: ready, zero blockers, package `0.1.10`, exactly one
  known daemon (PID `27124`), identity refresh unchanged;
- production `/v1/agent`: `200`, `status: READY`;
- production `/v1/agent/monitoring-pass`: expected `402`;
- pre-update official x402 validation: `valid: true`;
- ASP `5541` and services `33561`/`35958` matched the Lane 8R.3C.4 baseline.

## Hard-lock attestation

- ASP update invocations: exactly one.
- Payload variants or retries: none.
- Agent or service creation/deletion: none.
- `agent activate`, resubmission, payment, User registration: not run.
- A2A package/daemon change: none.
- Deployment or production-code change: none.
- A second state-changing command after the verdict: none.

## Evidence

- `preflight.json`
- `update-proof.json`
- `asp-readback.json`
- `route-and-x402.json`

## Exact next lane

Operator decision on the unchanged rejected/not-listed QA state after the
successful metadata write. No activation, resubmission, update, payment, User
registration, A2A change, or deployment is authorized by this closeout.
