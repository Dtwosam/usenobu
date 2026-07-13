# SerpApi connector offline capability report

**Status:** OFFLINE FIXTURE PROOF ONLY — not live  
**Date:** 2026-07-13  
**Provider:** SerpApi (third-party Google Shopping observation; **not** an official Target API)

## Live audit

| Item | Result |
|---|---|
| `SERPAPI_API_KEY` | **Absent** in environment |
| Live query executed | **No** |
| Live proof | **Blocked** |
| Blocker | `SERPAPI_API_KEY is not set` |

## Offline connector proof

Fixture-based unit tests cover:

| Scenario | Provider status |
|---|---|
| Single Target seller offer | `LIVE_TARGET_MATCH` |
| No Target seller | `NO_TARGET_RESULT` |
| Multiple Target sellers | `AMBIGUOUS_TARGET_RESULTS` |
| Target Plus only | `NO_TARGET_RESULT` (not counted as Target-sold) |
| Rate limit / out of searches | `PROVIDER_RATE_LIMITED` |
| Provider error body | `PROVIDER_ERROR` |
| HTTP 429 / 500 / timeout | locked error statuses |
| API key redaction | key never present in serialized results |

## Fields available in success fixture (not live)

| Field | Available in fixture |
|---|---|
| seller/source text | Yes (`Target`) |
| price / extracted_price | Yes (`29.99`) |
| product URL/link | Yes (target.com link) |
| product title | Yes |
| product_id | Yes (SerpApi id string; not proven TCIN) |
| observed_at | Yes (connector clock) |
| search_metadata.id | Yes |
| Target TCIN as first-class field | **Not proven** in fixture shape |
| Model / UPC dedicated fields | **Missing** unless present in raw row |
| Official Target API price | **Never** — third-party only |

## Searches consumed

| Mode | Count |
|---|---|
| Live | **0** |
| Fixture tests (in-memory counters) | Exercised; no SerpApi network calls |

## Disclaimer

This document does **not** invent live proof. Lane 3 live capability audit remains blocked until a server-side `SERPAPI_API_KEY` is provided and one bounded live query is run via `npm run serpapi:live-audit`.
