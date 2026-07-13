# Lane 7.5E — Nobu AI agent intake proof

**Date:** 2026-07-13  
**Production:** https://usenobu.vercel.app  
**Verdict:** `NOBU_LANE_7_5E_PROD_PROOF_PASS`

## Browser flow (Playwright against production)

Script: `run-browser-proof.mjs`

| Step | Result |
|---|---|
| Open Add purchase | OK — screenshot `01-add-purchase.png` |
| Synthetic NL description | OK |
| Fill details with AI | OK — confirmation gate visible; `02-ai-filled.png` |
| Form populated | price `12.34`, Target URL present |
| Edit a field | price → `11.00` |
| Find my product | review loads — `03-review.png` |
| Manual entry still works | review loads — `04-manual-review.png` |

Notes: `browser-notes.json`

## API proof

Script: `run-prod-proof.mjs` → `prod-api-proof.json`

| Check | Result |
|---|---|
| `POST /v1/agent` `UNDERSTAND_PURCHASE` | 200, `CONFIRMATION_REQUIRED`, `requires_user_action: true` |
| Does not run matching/monitoring | No match/monitor statuses; next = `CONFIRM_PURCHASE_DETAILS` |
| Raw purchase text absent from response | Yes |
| Secrets absent from response | Yes |
| `CHECK_CONFIRMED_PURCHASE` | 200, deterministic A2MCP statuses |
| `POST /v1/target-price-check` | 200, compatible |
| UI positioning copy | Homepage + add-purchase strings present |

## Provider note

Production ran with **deterministic extractor** (`provider: "deterministic"`) because `XAI_API_KEY` is not required for fallback. Set `XAI_API_KEY` (and optional `NOBU_AI_MODEL`) on Vercel for live LLM extraction. Fallback remains fail-closed and never invents identifiers.

## Privacy

- Audit logs use text hash/length/outcome only (no raw purchase text by default).
- Agent responses omit raw `purchase_text`.

## Next lane

**Lane 8 — OKX ASP registration and live listing**  
Listing endpoint: **https://usenobu.vercel.app/v1/agent**
