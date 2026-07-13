# Lane 7.5E.2 — Live Groq provider proof

**Production:** https://usenobu.vercel.app  
**Verdict:** `NOBU_LANE_7_5E_2_PASS`  
**Artifact:** `live-proof.json`

## Configuration (no secrets)

| Variable | Status |
|---|---|
| `GROQ_API_KEY` | Present on Vercel Production (encrypted) |
| `NOBU_AI_MODEL` | `openai/gpt-oss-20b` |

## Live checks

| Check | Result |
|---|---|
| `/health` `groq_configured` | `true` |
| `UNDERSTAND_PURCHASE` `provider` | **`groq`** |
| `agent_state` | `CONFIRMATION_REQUIRED` |
| Unknown model/UPC null when not in text | Yes |
| No match/monitor status on understand | Yes |
| Prompt-injection invented TCIN/UPC rejected | Yes |
| `/v1/target-price-check` | 200 |
| Browser NL fill + edit + review | Yes |
| Manual entry | Yes |
| Secrets / raw purchase text in API body | Absent |

## Screenshots

- `01-add-purchase.png`
- `02-ai-filled-groq.png`
- `03-review-after-ai.png`
- `04-manual-review.png`

## Fallback

Deterministic fallback remains for auth failure, rate limit, invalid output, timeout, and missing key (unit-tested). Live path uses Groq when configured.
