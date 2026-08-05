# Lane 8R.3C.6 — free A2MCP input-required validation

**Verdict:** `NOBU_LANE_8R_3C_6_PASS`
**Date:** 2026-07-26
**Requested base:** `3021f1a033408ccd5157153b81d7fcee1ed79e19`
**Deployed code commit:** `7a4ef1ef8f933c58f330ec34d78845f4836d1ea0`

## Outcome

The registered free endpoint `https://www.usenobu.xyz/v1/agent` now answers an empty validation request with HTTP `400`, `status: "input_required"`, `fields: ["action"]`, and `requiredArgs: ["action"]`. The body retains the full supported-action list and each action's required fields.

Official Onchain OS `4.4.0` reports `inputRequired: true` and `fields: ["action"]` for both its normal GET probe and its `--body '{}'` POST probe. Its `valid: false` value is expected for a free endpoint: `valid` means “x402-paid service,” while `inputRequired: true` is the successful service-input classification required by this lane.

Valid free actions still use the existing dispatcher. A direct `UNDERSTAND_PURCHASE` smoke returned HTTP `200`, `agent_state: "CONFIRMATION_REQUIRED"`. The Monitoring Pass endpoint remains HTTP `402`; official checks with and without `{}` both returned `valid: true`, x402 v2, `exact`, `eip155:196`, and `990000` minimal units.

No payment requirement was added to the free service. No paid-route file changed. No ASP update, activation, resubmission, payment, User registration, A2A change, or production-data mutation occurred.

## Changed files in the deployed code commit

- `app/v1/agent/route.ts`
- `src/a2mcp/service-descriptor.ts`
- `tests/a2mcp/free-agent-validation.test.ts`
- `openapi/nobu-a2mcp.openapi.yaml`

Proof/current-state documentation is committed separately after Production verification.

## Verification

| Check | Result |
|---|---|
| Focused free validation tests | 5/5 passed |
| Focused Monitoring Pass tests | 20/20 passed |
| Full unit suite | 56 files passed; 458 tests passed; 1 skipped |
| Typecheck | passed |
| Production build | passed |
| Local official free check | `inputRequired: true` for GET and `{}` POST |
| Local direct probes | `400 input_required`; valid action `200`; paid `402` |
| Production official free check | `inputRequired: true` for GET and `{}` POST |
| Production direct probes | `400 input_required`; valid action `200`; paid `402` |
| Production official paid check | `valid: true` for GET and `{}` POST |
| `git diff --check` | passed |

The initial focused test was intentionally run before implementation and failed on the three old `200` responses; after the narrow patch all five focused assertions pass.

## Deployment

- Vercel deployment ID: `B4DsuLSbWcR3S2b23XQv3nknXiPQ`
- Unique URL: `https://usenobu-95yc8u3kt-dtwoflicks-2878s-projects.vercel.app`
- Registered production alias: `https://www.usenobu.xyz` (explicitly re-aliased)
- Vercel also updated: `https://www.usenobu.xyz`

## Remaining blocker and exact next lane

This lane does not change ASP QA state. The exact next action remains the operator decision on the unchanged rejected/not-listed QA state recorded after Lane 8R.3C.5. No additional ASP update, activation, resubmission, payment, User registration, A2A change, deployment, or production-code change is authorized.

## Evidence files

- `local-proof.json` — local official-checker and direct route results
- `production-proof.json` — deployed alias, official-checker, and direct route results
- `test-proof.json` — test/typecheck/build results
- `scope-proof.json` — changed-file boundary and paid-route hashes
