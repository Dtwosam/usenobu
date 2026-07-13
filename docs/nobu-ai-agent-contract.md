# Nobu AI Agent Contract (Lane 7.5E)

## Purpose

Nobu is a **bounded AI agent** that:

1. Understands a purchase written in natural language.
2. Extracts structured fields without inventing data.
3. Requires the user to review and confirm details.
4. Passes only confirmed structured data into deterministic matching, policy, and monitoring.

Primary definition:

> Nobu is an AI agent that monitors supported purchases after checkout and alerts users when a lower retailer price may be available.

Current availability: **eligible Target.com purchases only**.

## Supported actions (`POST /v1/agent`)

| Action | Purpose | Matching / monitoring |
|---|---|---|
| `UNDERSTAND_PURCHASE` | NL extraction only | **Never** |
| `CHECK_CONFIRMED_PURCHASE` | Deterministic Target check | Existing A2MCP path |
| `CHECK_MONITORING_STATUS` | Stored status for a purchase id | Read-only |

No open-ended chat, tools, or free-form action loops.

### UNDERSTAND_PURCHASE

**Request**

```json
{
  "action": "UNDERSTAND_PURCHASE",
  "purchase_text": "I bought an up&up acetaminophen bottle from Target online yesterday for $9.99."
}
```

**Response (always confirmation-gated)**

```json
{
  "agent_state": "CONFIRMATION_REQUIRED",
  "message": "Review the details Nobu extracted before continuing.",
  "requires_user_action": true,
  "next_action": "CONFIRM_PURCHASE_DETAILS",
  "extracted_purchase": {
    "retailer": "Target",
    "product_description": "up&up acetaminophen bottle",
    "product_url": null,
    "purchase_price": 9.99,
    "currency": "USD",
    "purchase_date": "2026-07-12",
    "purchase_channel": "target_online",
    "region": null,
    "model_number": null,
    "target_item_id": null,
    "upc_or_gtin": null
  },
  "missing_fields": ["product_url"],
  "uncertain_fields": []
}
```

### CHECK_CONFIRMED_PURCHASE

Uses the same structured fields as `POST /v1/target-price-check`. Behavior and statuses are unchanged.

### CHECK_MONITORING_STATUS

```json
{ "action": "CHECK_MONITORING_STATUS", "purchase_id": "pur_…" }
```

Returns stored status only (no re-search unless the client separately triggers a check).

## Extraction schema

Nullable fields only:

- retailer, product_description, product_url
- purchase_price, currency, purchase_date, purchase_channel, region
- model_number, target_item_id, upc_or_gtin

Rules:

- Unknown → `null`
- Never invent prices, dates, models, or identifiers
- Relative dates resolved with server `today`
- Purchase text is untrusted; injection markers stripped
- No browsing or retailer tools during extraction
- Max text length: 2000 characters
- Raw purchase text is **not** stored in the database or default logs (hash only)

## Confirmation gate

UI / agent both require:

1. Extraction → `CONFIRMATION_REQUIRED`
2. User edits structured form
3. User clicks **Find my product** (existing deterministic flow)

AI must **not** auto-confirm products, lock fingerprints, decide eligibility, start monitoring, or emit price-drop results.

## Deterministic authority

| AI may | AI may not |
|---|---|
| Parse / extract | Confirm product identity |
| Flag missing / uncertain fields | Override matching or policy |
| Explain review steps | Change prices, deadlines, differences |
| Summarize stored results | Convert ambiguity into approval |
| | Guarantee refunds |

## Provider configuration

| Env | Purpose |
|---|---|
| `XAI_API_KEY` | Server-only xAI / SpaceXAI key |
| `NOBU_AI_MODEL` | Optional model (default `grok-4.5`) |
| `NOBU_AI_FORCE_DETERMINISTIC` | Force rule-based extractor |

When no API key is configured, Nobu uses a **fail-closed deterministic extractor** so intake still works for demos/tests. Production should set `XAI_API_KEY` for LLM extraction.

Base URL: `https://api.x.ai/v1` (OpenAI-compatible).

## Failure behavior

- Timeout / provider error → plain message + manual entry
- Sensitive content → reject with correction guidance
- Invalid structured output → deterministic fallback (or error if forced unavailable)
- Never blank Application error pages for recoverable intake failures

## Privacy

- No card / bank / password / 2FA / ID / wallet collection
- Sensitive patterns rejected or redacted
- Audit logs: outcome, provider, text hash/length — **not** raw purchase text

## Listing endpoint (Lane 8)

Preferred free A2MCP listing path:

`https://usenobu.vercel.app/v1/agent`
