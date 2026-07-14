# Lane 8 — OKX ASP registration evidence

**Date:** 2026-07-14  
**Verdict:** `NOBU_LANE_8_BLOCKED`

## Gate status

| Gate | Status |
|---|---|
| 1 Production preflight | **PASS** — `preflight.json` |
| 2 Onchain OS + wallet login | **PASS** — logged in (email mode); secrets redacted |
| 3 Register free A2MCP ASP | **PASS** — ASP **#5541** name **Nobu** (A2MCP fee `0`, endpoint usenobu `/v1/agent`) |
| 4 Marketplace list / activate | **BLOCKED** — A2A communication not ready (AI provider not bound) |

## Registration (real)

| Field | Value |
|---|---|
| Agent id | `5541` |
| Name | Nobu |
| Role | ASP |
| Service | Post-checkout price watch |
| Type | A2MCP |
| Fee | `0` |
| Endpoint | `https://usenobu.vercel.app/v1/agent` |
| validate-listing | pass |
| Avatar | uploaded (host `static.okx.com`) |

## Marketplace submission (real)

Activate failed before review submission:

```
A2A communication is not ready
→ bind AI provider: codex | claude | hermes | openclaw
→ okx-a2a doctor --fix until ready
→ retry activate #5541
```

No public listing URL. No approval status. No invent.

## Human action required

1. Bind a supported AI provider for `okx-a2a` (this Grok session is not in the CLI’s provider enum).
2. `okx-a2a doctor --fix` until `ready: true`.
3. `onchainos agent activate --agent-id 5541 --preferred-language en-US`
4. Capture real activate response → then PENDING_REVIEW or PASS as appropriate.

## Key artifacts

- `lane8-gate3-gate4-summary.json`
- `gate3-validate-listing.json`
- `gate3-create-redacted.json`
- `gate3-my-agents-redacted.json`
- `gate4-activate-raw-redacted.txt`
- `gate4-a2a-doctor-redacted.json`
- `preflight.json`
