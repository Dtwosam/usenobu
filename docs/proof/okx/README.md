# Lane 8 — OKX ASP registration evidence

**Date:** 2026-07-17
**Verdict:** `NOBU_LANE_8_PENDING_REVIEW`

## Gate status

| Gate | Status |
|---|---|
| 1 Production preflight | **PASS** — `preflight.json` |
| 2 Onchain OS + wallet login | **PASS** |
| 3 Register free A2MCP ASP | **PASS** — ASP **#5541** **Nobu** |
| 4 Marketplace review submit | **PASS (submitted 2026-07-14)** |
| 5 Avatar rejection fix + resubmit | **PASS (2026-07-17)** — avatar-only update on **#5541**; `submitApproval.success: true`, `approvalStatus: 2` |

## Registration (real)

| Field | Value |
|---|---|
| Agent id | `5541` |
| Name | Nobu |
| Service | Post-checkout price watch |
| Type | A2MCP |
| Fee | `0` |
| Endpoint | `https://www.usenobu.xyz/v1/agent` |

## Avatar rejection → resubmit (2026-07-17)

| Field | Value |
|---|---|
| Prior approval | **Listing rejected** (avatar quality + 440×440 / square-corners) |
| Change | **Avatar only** — no new agent; name/service/fee/endpoint unchanged |
| Local avatar | `nobu-asp-avatar-v2.png` — **440×440**, fully opaque square edges, polished software shield |
| Upload CDN | `…/agent/avatar/60657556-8076-4fa6-b5bc-4789c9983f64.png` |
| Update `newAgentId` | `null` (same agent) |
| Update `txHash` | `0xf664d1417f4fc5cbf8a0d94f4655eb1b58a201c497f6556ad385de140870a51f` |
| `submitApproval.success` | `true` |
| `submitApproval.approvalStatus` | `2` (under review) |
| Public listing URL | **None yet** |
| Publicly live | **No** |

Do **not** create another ASP. Do **not** repeatedly resubmit activation while status is under review.

## Monitoring

- Agentic Wallet email for approval / rejection
- Real ASP status via Onchain OS
- Lane 8 stays **active** until approved and publicly accessible
- **Lane 9** only after public live listing is proven

## Artifacts

- `lane8-avatar-resubmit-summary.json`
- `avatar-verify-v2.json`
- `nobu-asp-avatar-v2.png`
- `gate5-upload-v2-redacted.json`
- `gate5-update-avatar-redacted.json`
- `gate5-resubmit-activate-redacted.json`
- `lane8-gate3-gate4-summary.json`
- `gate4-activate-redacted.json`
- `gate3-*` registration evidence
- `preflight.json`
