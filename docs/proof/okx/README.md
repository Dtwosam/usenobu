# Lane 8 — OKX ASP registration evidence

**Date:** 2026-07-14  
**Verdict:** `NOBU_LANE_8_PENDING_REVIEW`

## Gate status

| Gate | Status |
|---|---|
| 1 Production preflight | **PASS** — `preflight.json` |
| 2 Onchain OS + wallet login | **PASS** |
| 3 Register free A2MCP ASP | **PASS** — ASP **#5541** **Nobu** |
| 4 Marketplace review submit | **PASS (submitted)** — `submitApproval.success: true`, `approvalStatus: 2` |

## Registration (real)

| Field | Value |
|---|---|
| Agent id | `5541` |
| Name | Nobu |
| Service | Post-checkout price watch |
| Type | A2MCP |
| Fee | `0` |
| Endpoint | `https://usenobu.vercel.app/v1/agent` |

## Marketplace submission (real)

| Field | Value |
|---|---|
| `submitApproval.success` | `true` |
| `submitApproval.approvalStatus` | `2` (under review) |
| `activate.success` | `false` |
| `activate.rejectReason` | `null` |
| Public listing URL | **None yet** |
| Publicly live | **No** |

Do **not** create another ASP. Do **not** repeatedly resubmit activation while status is under review.

## Monitoring

- Agentic Wallet email for approval / rejection
- Real ASP status via Onchain OS
- Lane 8 stays **active** until approved and publicly accessible
- **Lane 9** only after public live listing is proven

## Artifacts

- `lane8-gate3-gate4-summary.json`
- `gate4-activate-redacted.json`
- `gate3-*` registration evidence
- `preflight.json`
