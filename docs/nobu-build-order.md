# Nobu Active Build Order

**Status:** ACTIVE BUILD ORDER  
**Date:** 2026-07-13

The build proceeds lane by lane. A lane closes only when its required proof passes.

## Lane 0 — Source-of-truth adoption and repository baseline

- Add this pack to the repository.
- Create baseline README and environment example.
- Record framework/database/deployment choices in an ADR if they differ from the reference stack.
- Confirm clean git status.
- No product implementation yet.

**Proof:** required files present; mandatory-doc check; no secrets.

## Lane 1 — Domain schemas and deterministic contracts

- Purchase input schema.
- Product candidate and locked fingerprint schema.
- Price observation schema.
- Target policy result schema.
- Status enums.
- Database migrations.
- Pure unit tests.

**Proof:** schema validation and migration tests pass.

## Lane 2 — Target policy engine

- Implement supported online channel and geography.
- Implement 14-day calculation.
- Implement exclusions represented in user input/data.
- Implement fail-closed unknown conditions.
- Bind responses to policy ID/version.

**Proof:** full Target policy fixture matrix passes.

## Lane 3 — SerpApi connector and live capability audit

- Add server-side client.
- Normalize Google Shopping response.
- Add safe error/rate-limit handling.
- Run a bounded live query for a selected Target product.
- Record whether a Target offer, stable identifiers, price, URL, seller, and timestamp are available.
- Do not implement optimistic matching until the live audit proves available fields.

**Proof:** redacted live response fixture, field report, search-count record, no key leakage.

## Lane 4 — Candidate matching and product confirmation

- Generate Target-only candidates.
- Implement strong identifier/model matching.
- Require user confirmation before monitoring.
- Store locked fingerprint.
- Reject title-only and ambiguous matches.

**Proof:** exact match, wrong model, wrong seller, Target Plus, ambiguous, and variant mismatch tests pass.

## Lane 5 — Price monitoring loop

- Active-window selection.
- Search-budget guard.
- Scheduled/manual check runner.
- Price observation history.
- Lower-price detection.
- Expiry handling.
- Idempotent repeated checks.

**Proof:** simulated price drop produces one alert; replay does not duplicate it; expired purchase is not checked.

## Lane 6 — Consumer web flow

- Add purchase.
- Review/confirm candidate.
- Monitoring dashboard.
- Alert/result page.
- Target official action instructions.
- Supported-case and privacy notices.

**Proof:** end-to-end browser path using real provider data where available and clearly labelled fixtures where not.

## Lane 7 — Free A2MCP endpoint

- Implement OpenAPI contract.
- Public HTTPS deployment.
- HTTP 200 JSON response.
- Rate limiting and input validation.
- Health endpoint.
- Curl proof.

**Proof:** external curl succeeds; ambiguous match fails closed; no sensitive data in output.

## Lane 7.5A — Global Nobu rename

- Rename active project identity to Nobu across UI, docs, package metadata, OpenAPI, prompts, env names, and source comments.
- Keep A2MCP routes `/health` and `/v1/target-price-check` unchanged.
- Do not change Target policy, matching, monitoring, or HTTP contract behavior.

**Proof:** active repository scan empty of the prior brand; tests, typecheck, and build pass.

## Lane 7.5B1 — Design foundation and reusable UI components

- Design tokens, Manrope typography, global shell (header/footer/mobile nav).
- Reusable components with hover/active/focus/disabled/loading/error states.
- First-time UX rules, accessibility, and foundation proof gallery.
- Do **not** fully redesign product screens in this lane.
- No OKX registration.

**Proof:** design spec, foundation screenshots, component/a11y tests, unit/typecheck/build pass.

## Lane 7.5B2 — Complete screen implementation

- Redesign consumer product screens on the 7.5B1 foundation.
- Preserve product locks, notices, fail-closed flows, and E2E contracts.
- No OKX registration in this lane.

**Proof:** browser path still works; brand and UI updated; tests pass.

## Lane 7.5B3 — Visual QA, polish and deployment

- Visual QA against the design reference and design system.
- Polish spacing, copy, and residual a11y issues.
- Deploy consumer UI only after proof; still no OKX registration until Lane 8.

**Proof:** polished screenshots, residual fixes, deployment evidence if approved.

## Lane 7.5C — UseNobu production identity

- Remove every residual prior-brand string, path, and proof archive from the working tree.
- Vercel project name: `usenobu`.
- Primary production URL: `https://usenobu.vercel.app` (public, no SSO).
- Product name remains Nobu; deployment identity is UseNobu.
- No OKX registration in this lane.

**Proof:** case-insensitive prior-brand repository scan empty; production health and A2MCP checks on usenobu.vercel.app; proof under `docs/proof/usenobu-production/`.

## Lane 7.5D — Universal product positioning

- Position Nobu as a universal post-purchase price-monitoring platform.
- Target remains the first and only live retailer integration.
- Update consumer copy, metadata, and source-of-truth wording without changing Target logic or APIs.
- No other retailers, fake options, or OKX registration.

**Proof:** homepage/add-purchase/notices positioning tests; Target-only logic unchanged; unit/typecheck/build/e2e pass.

## Lane 7.5D.1 — Production Find my product repair

- Fix serverless migration scandir ENOENT and Vercel DB path.
- Cookie snapshot for demo persistence across instances.
- Safe form errors; no blank application-error page.

## Lane 7.5E — Bounded AI agent + NL purchase intake ✅ COMPLETE

- Natural-language intake with confirmation gate.
- `POST /v1/agent` actions: UNDERSTAND_PURCHASE, CHECK_CONFIRMED_PURCHASE, CHECK_MONITORING_STATUS.
- AI extraction never starts matching/monitoring.
- Existing `/v1/target-price-check` unchanged.
- Listing path for Lane 8: `https://usenobu.vercel.app/v1/agent`.

**Proof:** AI unit tests, e2e intake, production browser NL flow, agent API checks under `docs/proof/nobu-ai-agent/`.

## Lane 7.5E.2 — Migrate AI extraction to Groq + activate live provider ✅ COMPLETE

- Replace unactivated xAI path with **Groq** (`GROQ_API_KEY`, default model `openai/gpt-oss-20b`).
- Strict JSON schema extraction; deterministic fallback retained.
- Health: `groq_configured` boolean + model name only.
- Live production: `provider: "groq"` proven.

**Proof:** `docs/proof/nobu-ai-agent/live-groq-provider/` — `NOBU_LANE_7_5E_2_PASS`.

## Lane 8 — OKX ASP registration and live listing (**ACTIVE — PENDING REVIEW**)

- Register free A2MCP ASP using **`https://usenobu.vercel.app/v1/agent`**.
- Accurate listing: AI agent + Target-only live integration.
- Install/use Onchain OS according to current official instructions.
- Register A2MCP ASP with price `0`.
- Submit for review; address reviewer feedback.
- Record live listing evidence only when genuinely approved and public.

**Progress (2026-07-14):** ASP **#5541 Nobu** registered; marketplace **`submitApproval.success: true`**, **`approvalStatus: 2`** (under review). Not publicly live. Evidence: `docs/proof/okx/`. Verdict: **NOBU_LANE_8_PENDING_REVIEW**.

**Review-Safe Sprint A (2026-07-14):** Core product proof — bounded **Check price now**, compact Monitoring Proof panel, short decision explanations. Evidence: `docs/proof/ui/core-product-proof/`. Verdict: **NOBU_REVIEW_SAFE_A_PASS**. Does **not** complete Lane 8.

**Review-Safe Sprint A.1 (2026-07-14):** Production manual check uses **live SerpApi** (fixtures gated for tests/e2e only). Evidence: `docs/proof/ui/core-product-proof/live-manual-check/`. Verdict: **NOBU_REVIEW_SAFE_A_1_PASS**.

**Review-Safe Sprint B (2026-07-14):** Compact **Action Center** for accepted price differences (Open on Target, Contact Target, Copy details, View details). Evidence: `docs/proof/ui/action-center/`. Verdict: **NOBU_REVIEW_SAFE_B_PASS**.

**Review-Safe Sprint C (2026-07-14):** Homepage judge clarity — retailer-neutral hero, money-back benefit, current Target availability, user-testing kit. Evidence: `docs/proof/ui/judge-clarity/`, `docs/user-testing/`. Verdict: **NOBU_REVIEW_SAFE_C_PASS**.

**Proof for PASS:** approved, live listing. Do not claim completion before this exists.

## Lane 9 — Demo and submission closeout

- 90-second-or-shorter demo.
- Realistic purchase and observed price flow.
- Clearly identify third-party price source and Target final verification.
- X post with `#OKXAI`.
- Official form with ASP and X link.
- Archive submission evidence.

**Proof:** post URL, duration, form confirmation, live ASP.

## Lane 10 — Optional post-listing enhancements

Only if time remains after Lane 8 proof:

- receipt image parsing;
- email alerts;
- paid x402 monitoring/check service;
- more live Target products;
- capacity dashboard.

No second retailer during the hackathon MVP.
