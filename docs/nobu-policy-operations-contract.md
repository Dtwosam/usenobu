# Nobu Policy Operations Contract — Lane 8-R1A

**Status:** ACTIVE  
**Scope:** Target U.S. online price-match policy only  
**Approved policy ID:** `target-us-online-price-match-v1`  
**Last official-source verification (approved snapshot):** `2026-07-19T18:00:00.000Z`

## Purpose

Separate **approved Target policy rules** from **operational review metadata**.

The 24-hour hackathon interval is an **owner-review reminder**, not a production shutdown timer. An overdue review becomes `CHECK_DUE` and continues service with a visible warning. `POLICY_STALE` is reserved for genuinely unusable or retired policy states (or source-unavailable past grace).

## Approved policy vs operations

| Layer | Contents | Mutability |
|---|---|---|
| Approved rules | Window, geography, exclusions, claim route, identifiers | Code/YAML change + owner material-change process; never silent auto-apply |
| Operations record | Review timestamps, `review_state`, owner alerts, pending reviews | Runtime owner/scheduler updates without redeploy for `UNCHANGED` |

## Versioned policy operations record

| Field | Required | Notes |
|---|---|---|
| `policy_id` | yes | e.g. `target-us-online-price-match-v1` |
| `policy_version` | yes | e.g. `v1` |
| `approved_at` | yes | When this rule snapshot was approved |
| `source_url` | yes | Official Target policy URL (manual review) |
| `source_last_checked_at` | yes | Last owner-confirmed source check |
| `next_review_at` | yes | `source_last_checked_at + review_interval_hours` |
| `review_state` | yes | See states below |
| `source_fingerprint` | optional | Owner-supplied normalized hash/note; never scraped |
| `last_owner_alert_at` | optional | Last durable owner alert time |
| `review_note` | optional | Free-text operator note |
| `retired_at` | nullable | Set when `RETIRED` |

**Defaults (hackathon):**

- `review_interval_hours`: `24` (reminder only)
- `source_unavailable_grace_hours`: `72`

## Review states

### `CURRENT`

- Normal matching, observation, policy evaluation, and result.
- No policy-review warning.

### `CHECK_DUE`

- Continue using the last **approved** policy.
- Continue product discovery, matching, monitoring, and price comparison.
- Include a visible policy-review warning in API and relevant UI.
- Create **one** durable owner alert (idempotent).
- Do **not** return `POLICY_STALE` merely because 24 hours elapsed.

### `SOURCE_UNAVAILABLE`

- Continue using the last approved policy during the configured grace window.
- Include warning + owner alert.
- Do **not** pretend the source was checked successfully (`source_last_checked_at` unchanged on this path).
- After grace expires → non-positive block (`POLICY_STALE` with reason `policy_source_unavailable_grace_expired`).

### `CHANGE_DETECTED` / `REVIEW_REQUIRED`

- Continue Target URL handling, exact-product matching, price observation, monitoring, and price-difference calculation.
- Do **not** issue a new positive eligibility conclusion (`POTENTIALLY_ELIGIBLE`).
- Return observed factual prices plus an explicit policy-review warning.
- Preserve Target as the final decision-maker.
- Never silently apply changed eligibility rules.

### `RETIRED`

- Stop positive Target policy evaluation.
- Return clear non-positive service state (`POLICY_STALE` / `policy_retired`).
- Do **not** delete historical observations or purchases.

## `POLICY_STALE` rule

Use `POLICY_STALE` **only** when the policy is genuinely unusable:

- `RETIRED`
- `SOURCE_UNAVAILABLE` past grace
- explicit force-unusable test path

Ordinary overdue review → `CHECK_DUE`, **not** `POLICY_STALE`.

## Owner review workflow

Protected endpoints (Bearer `OWNER_OPS_SECRET` or fallback `CRON_SECRET`):

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v1/owner/policy-status` | Status + pending action count |
| `POST` | `/v1/owner/policy-review` | Record owner action |
| `POST` | `/v1/owner/policy-scheduler` | Idempotent overdue → `CHECK_DUE` + alert |
| UI | `/owner/policy` | Minimal status page (no secret in page) |

### Owner actions

| Action | Effect |
|---|---|
| `UNCHANGED` | Update `source_last_checked_at`; recompute `next_review_at`; restore `CURRENT`; clear active owner alerts. **No code edit or redeploy.** |
| `MATERIAL_CHANGE_DETECTED` | Preserve old approved policy; create pending review record; set `REVIEW_REQUIRED`; never auto-apply new rules. |
| `SOURCE_UNAVAILABLE` | Set `SOURCE_UNAVAILABLE`; do not update successful check timestamp. |
| `RETIRED` | Set `RETIRED` + `retired_at`; stop positive evaluation. |

Unauthorized requests → `401`. Missing secret configuration → `503`.

## Scheduler rules

- Marks overdue `CURRENT` as `CHECK_DUE`.
- Creates **at most one** active owner alert per overdue review key.
- Idempotent on repeat runs.
- Does **not** fetch or scrape Target.
- Does **not** automatically approve policy changes.
- Owner reviews the official Target policy URL **manually** until an approved machine-readable change source exists.

## A2MCP response extensions (backward compatible)

Request contract unchanged. Response may include:

- `policy_version`
- `policy_verified_at`
- `policy_review_state`
- `policy_warning`
- `eligibility_suppressed`

Existing required fields (`status`, `policy_id`, `price_source_type`, `final_decision_by`, `checked_at`) remain.

## Hard locks

- No Target scraping or automated extraction from Target policy/product pages.
- Target only — no second retailer.
- No claim submission, retailer login, card/bank/secret collection.
- No guarantee of adjustment/refund.
- AI must not approve or rewrite policy rules.
- Exact-product matching remains fail-closed.
- Material policy changes are never silently auto-applied.

## Official source

- Primary: `https://www.target.com/help/articles/policies-guidelines/price-match-guarantee`
- Alternate article form: `https://www.target.com/help/article/000062256`
- Contact route: `https://www.target.com/help/contact-us`
- Guest Services phone: `1-800-591-3869`

Substantive MVP rules (unchanged at last verification): 14 calendar days after purchase; Target.com/app online; sold by Target (Target Plus excluded from MVP); U.S. excluding AK/HI; original receipt/packing slip required; Target verifies and decides.
