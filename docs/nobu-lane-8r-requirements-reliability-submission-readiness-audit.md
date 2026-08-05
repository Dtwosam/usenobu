# Lane 8R — Requirements, Reliability and Submission Readiness Audit

**Lane type:** Audit-only. No product, test, deployment, or listing changes were made in this lane.
**Audit date:** 2026-07-18 (report generated 2026-07-18T22:33:30Z)
**Auditor scope:** Static inspection of repository source, docs, and existing proof artifacts, plus targeted external verification. No destructive or production-mutating action was taken.

---

## 1. Executive verdict

**`NOBU_LANE_8R_BLOCKED`**

Nobu's deterministic architecture (policy engine, matching engine, A2MCP contract, privacy/security guards) is well-built, fail-closed, and consistent with its own contracts. However, the product is currently **not able to produce its core positive result in production**, and its **OKX listing is not approved/live**. Two independent, currently-active defects block the compulsory requirements:

1. **Policy freshness has lapsed in production.** The locked Target policy (`src/policy/target-us-policy.ts`) was last verified `2026-07-14T20:00:00.000Z` with a 24‑hour freshness ceiling. As of this audit (`2026-07-18T22:33:30Z`), the policy is **~3 days past its own freshness ceiling**, with no bypass flag set anywhere in the repository or found env files. Under the code's own deterministic rule, **every real production request to `/v1/target-price-check` and `/v1/agent` (`CHECK_CONFIRMED_PURCHASE`) currently returns `POLICY_STALE`**, not a usable eligibility result. This is a live, reproducible-today defect, not a hypothetical one.
2. **The OKX listing is not approved or public.** Agent `5541` (Nobu) was rejected once for avatar quality, was avatar-only resubmitted on 2026-07-17, and is currently `approvalStatus: 2` ("under review"). There is no public listing URL and no evidence of approval. Per the hackathon's own compulsory rule ("non-live/unapproved listing is invalid") and the build order's own closing condition ("Proof for PASS: approved, live listing"), **Lane 8 is not closed**, and Lane 9 (demo/submission closeout) cannot honestly be started.

Everything downstream of these two defects (matching, monitoring, provenance, privacy language) is well engineered and passes static/code-level review, but per the task's own evidentiary rule ("a fixture is not live evidence"), the **canonical, end-to-end, live-price-drop-to-recovery path has never been proven on the production A2MCP route** — the only historical "PASS" for that outcome ran through a diagnostic route that has since been removed (`docs/proof/live-price-reproducibility/README.md`). This is a second material submission-readiness gap.

The reported July 27, 2026 hackathon extension could **not be independently verified against an official OKX-owned domain** from this environment (see §13, §10) and must be treated as **unresolved** until reverified against `web3.okx.com` / `okx.com` directly.

---

## 2. Baseline commit and repository status

| Item | Value |
|---|---|
| Starting HEAD | `299fe0e4930367a2b6e9d73341080ebd798f5af5` |
| Branch | `master` |
| Working tree at start | Dirty — see below |

```
 M docs/nobu-build-order.md
 M docs/nobu-current-state.md
 M docs/proof/okx/README.md
?? docs/proof/okx/avatar-verify-v2.json
?? docs/proof/okx/gate5-resubmit-activate-redacted.json
?? docs/proof/okx/gate5-update-avatar-redacted.json
?? docs/proof/okx/gate5-upload-v2-redacted.json
?? docs/proof/okx/lane8-avatar-resubmit-summary.json
?? docs/proof/okx/nobu-asp-avatar-v2.png
```

These uncommitted changes are the **avatar-repair and resubmission evidence** that this audit is explicitly instructed to inspect (Lane 8 gate 5: avatar rejection fix + resubmit, dated 2026-07-17). They are in-scope, pre-existing work-in-progress, not unrelated dirty state. Per instruction, they were **read only and left untouched** — not staged, not committed, not reverted. `git diff --check` (see §14) confirms no whitespace-conflict markers in the modified tracked files.

---

## 3. Official requirement matrix (hackathon)

Source read: `docs/nobu-hackathon-compliance-matrix.md`, `docs/nobu-submission-runbook.md`, `docs/external-source-registry.md`, plus external verification in §10/§13.

| Requirement | Nobu status | Evidence | Verdict |
|---|---|---|---|
| Clear real-world use case | Post-checkout Target price monitoring | `docs/nobu-clean-master-spec.md` | PASS (design) |
| Functional ASP, free A2MCP endpoint | `/v1/agent`, `/v1/target-price-check`, `/health` deployed at `https://www.usenobu.xyz` | `app/v1/agent/route.ts`, `app/v1/target-price-check/route.ts`, `app/health/route.ts`, `docs/proof/okx/preflight.json` | PASS (endpoint exists) but see policy-freshness defect below |
| Approved and live listing | Agent `5541` rejected once (avatar), avatar-only resubmitted 2026-07-17, `approvalStatus: 2` (under review), no public listing URL | `docs/proof/okx/README.md`, `docs/proof/okx/lane8-avatar-resubmit-summary.json`, `docs/proof/okx/gate5-resubmit-activate-redacted.json` | **BLOCKED** |
| X post with `#OKXAI` | Not yet produced (Lane 9 activity) | No proof artifact under `docs/proof/` | **NOT_PROVEN** |
| Demo ≤ 90 seconds | Not yet recorded | `docs/nobu-submission-runbook.md` describes required story only | **NOT_PROVEN** |
| Official submission form | Not yet submitted | No confirmation artifact | **NOT_PROVEN** |
| Submission deadline | Internal docs hardcode `2026-07-17 23:59 UTC`, which is **before today's audit date (2026-07-18)** | `docs/nobu-hackathon-compliance-matrix.md:4`, `docs/nobu-submission-runbook.md:78` | **UNRESOLVED / internally stale — see §10, §13** |
| Reported July 27, 2026 extension | Corroborated by two independent web sources (WebSearch) and a direct fetch of `hackquest.io` (a hackathon co-host/hosting platform, not `okx.com` itself), showing a **separate final Google Form deadline of `2026-07-27 23:59 UTC`**, distinct from the ASP listing-submission window (`2026-07-03`–`2026-07-17`) | See §10, §13 | **UNRESOLVED against a primary OKX-owned source** — `web3.okx.com` and `okx.com` were unreachable (DNS failure) from this environment in every attempt |
| Best Product / category judging | Product experience described; judged only after listing is live | `docs/nobu-clean-master-spec.md` §5 | Contingent on listing approval |
| Revenue Rocket / Social Buzz | Explicitly optional, not a launch blocker | `docs/nobu-hackathon-compliance-matrix.md:18-19` | OPTIONAL |

---

## 4. Master-spec success-criterion matrix

Source: `docs/nobu-clean-master-spec.md` §10.

| Success criterion | Status | Evidence |
|---|---|---|
| User can register a supported Target.com purchase | PASS | `app/purchases/new/page.tsx`, `src/web/purchase-service.ts`, tests in `tests/web/` |
| Exact Target product confirmed and fingerprinted | PASS | `app/purchases/[id]/review/page.tsx`, `src/matching/confirm.ts`, `src/web/exact-identity.ts` (hard TCIN+model/UPC gate) |
| Scheduled/triggered check obtains a **live** SerpApi result | **BLOCKED in production right now** | Freshness lapse (see §1, §6) forces `POLICY_STALE` before any SerpApi call is reached for a confirmed purchase check |
| System rejects ambiguous/non-Target/mismatched results | PASS | `src/matching/rules.ts`, `src/matching/evaluate.ts`, `src/monitoring/detect.ts` — all fail closed; unit tests in `tests/matching/`, `tests/monitoring/` |
| Lower observed Target price produces correct recovery + deadline | **NOT_PROVEN end-to-end on canonical route** | The only historical acceptance (`$29.99` AirTag) ran through a now-deleted `/v1/capability-audit` diagnostic route with a synthetic fingerprint, not the canonical `/v1/target-price-check`/`/v1/agent` path. The canonical route's own live probe returned `MATCH_REVIEW_REQUIRED`. See `docs/proof/live-price-reproducibility/README.md`. |
| A2MCP endpoint returns documented HTTP 200 | PASS | `docs/proof/usenobu-production/prod-target-price-check.json`, `docs/proof/okx/preflight.json` |
| Service deployed over HTTPS | PASS | `https://www.usenobu.xyz` |
| ASP approved and live on OKX.AI | **BLOCKED** | Under review, not public (§3) |
| X demo ≤ 90 seconds | NOT_PROVEN | Not yet produced |
| Official submission form completed before deadline | NOT_PROVEN / deadline itself unresolved | §3, §10 |

---

## 5. A2MCP/listing contract matrix

Source: `openapi/nobu-a2mcp.openapi.yaml` vs. `app/v1/agent/route.ts`, `app/v1/target-price-check/route.ts`, `app/health/route.ts`, `src/a2mcp/*`.

| Contract item | Deployed behavior | Verdict |
|---|---|---|
| `POST /v1/agent` — 3 fixed actions, strict schema (`oneOf`, `additionalProperties: false`) | `src/a2mcp/schemas.ts`-equivalent `AgentRequestSchema` in `src/ai/schemas.ts`/`agent-service.ts` enforces the same 3 actions; route rejects unknown/sensitive fields pre-parse (`app/v1/agent/route.ts:38-55`) | PASS |
| `POST /v1/target-price-check` request/response shape | `src/a2mcp/schemas.ts` — `.strict()` Zod schema matches OpenAPI required fields exactly (`target_product_url`, `purchase_price`, `currency: USD`, `purchase_date`, `country: US`, `purchase_channel: target_online`) | PASS |
| Response `status` enum matches OpenAPI `TargetPriceCheckResponse.status` | Verified identical 10-value enum in `src/a2mcp/schemas.ts` `A2mcpStatusSchema` | PASS |
| `price_source_type` always `THIRD_PARTY_SEARCH_OBSERVATION`, `final_decision_by` always `Target` | Enforced as Zod literals (`src/a2mcp/schemas.ts:52-53`) and set in `baseResponse()` (`src/a2mcp/check-service.ts:43-63`) — cannot be overridden by any code path | PASS |
| Invalid input → documented 4xx | `runA2mcpTargetPriceCheck` returns `400 invalid_input` on schema failure (`src/a2mcp/check-service.ts:131-140`) | PASS |
| Ambiguous evidence never returns positive | `MATCH_REVIEW_REQUIRED` returned whenever `match.ambiguous \|\| !match.match_ok` (`src/a2mcp/check-service.ts:282-290`) before any price comparison | PASS |
| Provider failure degrades safely | `DATA_SOURCE_UNAVAILABLE` / HTTP 503 on missing key, provider error, rate limit, or thrown exception (`src/a2mcp/check-service.ts:177-269`) | PASS |
| Rate limiting present | `SlidingWindowRateLimiter`, 30 req/min/key, applied to both routes (`src/a2mcp/rate-limit.ts`, both `route.ts` files) | PASS, with a caveat: the limiter is **in-process, per-instance** (`src/a2mcp/rate-limit.ts:1-5` comment). On Vercel's serverless model this does not enforce a single global ceiling across concurrent instances/cold starts. Not a blocker for hackathon-scale traffic, but not a durable production guarantee either. |
| No secrets/PII leak | `assertResponseHasNoSecrets()` throws if the configured API key string appears in the response body or if raw `password`/`card_number` fields are present (`src/a2mcp/audit.ts:41-55`); health route reports booleans only (`app/health/route.ts`) | PASS |
| Registered listing copy matches behavior | `docs/nobu-submission-runbook.md` listing description ("understands NL... requires user confirmation... Target verifies... final decision") matches actual `disclaimer` text emitted by `DEFAULT_POLICY_DISCLAIMER` (`src/policy/target-us-policy.ts:93-94`) verbatim in spirit | PASS |
| **Policy freshness gate** | `evaluateTargetPolicy` returns `POLICY_STALE` when `hoursBetween(policy.verified_at, evaluated_at) > policy.max_freshness_hours` and no `skip_freshness_check` (`src/policy/evaluate-target-policy.ts:119-138`). `policy.verified_at = 2026-07-14T20:00:00.000Z`, `max_freshness_hours = 24`. No occurrence of `A2MCP_SKIP_POLICY_FRESHNESS=1` in any env file (`.env.audit`, `.env.example`, `.env.local`) or config found in the repo. | **Currently firing in production — BLOCKED** |

---

## 6. Core-flow and reliability findings

Journey audited: `enter purchase → identify exact product → confirm product → lock fingerprint → check observed price → evaluate policy → show result → show Target's official next step`.

| Step | Implemented | Reachable | Honestly represented | Notes |
|---|---|---|---|---|
| Enter purchase (NL or manual) | Yes | Yes | Yes | `app/purchases/new/page.tsx`, `PurchaseIntake.tsx`; AI extraction gated by confirmation, never auto-locks (`src/ai/agent-service.ts`, `src/ai/understand-purchase.ts`) |
| Identify exact product | Yes | Yes | Yes | `src/matching/candidates.ts`, `src/web/live-discovery.ts` |
| Confirm product (once) | Yes | Yes | Yes | `app/purchases/[id]/review/page.tsx` — confirm form only renders when `decision === EXACT_MATCH_CANDIDATE && !title_only` (`review/page.tsx:52-56`) |
| Lock fingerprint | Yes | Yes | Yes | `src/matching/store.ts`, `src/matching/confirm.ts` |
| Check observed price | Yes (code) | **No, in production, right now** | N/A | Blocked upstream by `POLICY_STALE` (§1, §5) before a SerpApi call for a confirmed-purchase check |
| Evaluate policy | Yes | Yes, but returns `POLICY_STALE` unconditionally at present | Yes — the stale response is itself honest and fail-closed, it does not fabricate an outcome | This is a *safe* failure mode (no false positive), but it is a **complete availability failure** of the product's one compulsory positive-path proof |
| Show result | Yes | Yes for non-price-drop statuses; unproven for the positive path | Yes | `ActionCenter.tsx`, `app/purchases/[id]/alerts/[alertId]/page.tsx` |
| Show Target's official next step | Yes | Yes | Yes | Contact URL `https://www.target.com/help/contact-us`, phone `1-800-591-3869` sourced from `TARGET_US_POLICY.claim_route` (`src/policy/target-us-policy.ts:76-81`) — Nobu never auto-submits |

**Session/UX resilience:** `app/purchases/[id]/review/page.tsx:32-36` explicitly redirects to `/purchases/new?error=session_lost` rather than showing a bare 404 when the serverless session cookie is unavailable across instances — a documented, deliberate repair (Lane 7.5D.1). This is a good defensive pattern given the app's known ephemeral-instance constraint.

**Fixture vs. live labelling:** `review/page.tsx:89-102` renders a visible `DemoDataBanner` for fixture data and a screen-reader-only "LIVE third-party observation" marker for live data — correctly distinguishes the two per Section I's requirement, and machine-testable via `data-testid="discovery-data-source"`.

---

## 7. Matching, policy and provenance findings

### Matching (fail-closed) — `src/matching/rules.ts`, `src/matching/evaluate.ts`

| Case | Behavior | Evidence |
|---|---|---|
| Exact Target URL / TCIN | Strong match, highest tier | `evaluate.ts:112-142` |
| Exact manufacturer model + Target seller + compatible variant | Strong match, gated by title-similarity ≥ 0.72 when model is title-derived (`evaluate.ts:99-106`) to block accessory false positives | PASS |
| UPC/GTIN + Target seller | Strong match, lowest of the four strong tiers | `evaluate.ts:187-197` |
| Wrong seller | Hard reject (`non_target_seller`) | `evaluate.ts:51-61` |
| Wrong model | Hard reject (`wrong_model`) | `evaluate.ts:170-184` |
| Wrong variant (size/color/weight/quantity conflict) | Hard reject (`variant_mismatch`) | `evaluate.ts:63-75, 257-275` |
| Accessory rejection | `titleLooksAccessory()` regex (`case|loop|keychain|holder|strap|wallet|insert|band|cover|pouch|sleeve`) prevents accessory/main-SKU merge in dedupe | `evaluate.ts:332-337` |
| Ambiguous multiple candidates | Distinct incompatible strong groups → `MATCH_REVIEW_REQUIRED`, never auto-picks | `evaluate.ts:439-457` |
| Title-only rejection | Never confirmatory; always `MATCH_REVIEW_REQUIRED` at best | `evaluate.ts:211-224`, `MatchTier.TITLE_ONLY` |
| Locked-fingerprint monitoring | Later checks validate only against the locked fingerprint; ambiguous re-observation suppresses the alert (`suppress_alert_reason: "ambiguous_observation"`) | `src/monitoring/detect.ts:38-66` |
| SerpApi `product_id` never treated as TCIN | Explicit code comments and dedicated no-op guard (`evaluate.ts:126-133`) plus `matched_product.note` field in the A2MCP response body (`check-service.ts:324`) | PASS |

Verdict: **fail-closed matching is intact and well-tested** (`tests/matching/matching.test.ts`, `tests/matching/dedup-candidates.test.ts`, `tests/matching/locked-fingerprint-monitor.test.ts`).

### Target policy — `src/policy/target-us-policy.ts`, `src/policy/evaluate-target-policy.ts`

- 14-day window, boundary (`daysSince > windowDays` → `WINDOW_EXPIRED`), expired handling, geography (AK/HI), channel, Target Plus, and known/unknown exclusions are all implemented deterministically and fail closed on unknown exclusion labels (`evaluate-target-policy.ts:238-253`, `"unknown_exclusion_fail_closed"`).
- **Current official Target policy vs. Nobu's narrower MVP scope:** external verification (§10) surfaced that Target's real, current policy allows a **narrower Target Plus price-match** in some circumstances (a Target Plus item bought in the last 14 days may match against a now-lower **Target.com** price). Nobu's MVP **excludes all Target Plus unconditionally** (`AGENTS.md:39`, `TARGET_US_POLICY.supported.target_plus: false`). This is a legitimate, already-documented intentional scope-narrowing (not a bug), but the audit flags it explicitly per the task's instruction to separate "current official Target policy" from "Nobu's narrower intentional MVP scope" — the two are not identical, and listing/demo copy should continue to say "Target Plus is not supported" rather than imply this mirrors Target's own Target Plus exclusion.
- **Policy version and verification timestamp:** `policy_id: target-us-online-price-match-v1`, `verified_at: 2026-07-14T20:00:00.000Z` in code (`src/policy/target-us-policy.ts:16`) vs. `docs/nobu-target-policy-contract.md:5` stating "Last verified: 2026-07-15" — a **one-day drift between the contract doc and the code constant**. Neither has been reverified since, and both are now stale under the 24-hour rule (see §1).
- Target final-decision language and official contact route are present and correct everywhere checked (`final_decision_by: "Target"`, `contact_url: https://www.target.com/help/contact-us`, phone `1-800-591-3869`).

### SerpApi and provenance — `src/serpapi/*`

| Item | Status | Evidence |
|---|---|---|
| Server-only key handling | PASS | `SERPAPI_API_KEY` read only in `src/serpapi/client.ts`; `isSerpApiConfigured()` boolean-only in `/health` |
| Google Shopping response normalization | PASS | `src/serpapi/normalize.ts`, `src/serpapi/utf8.ts` |
| Target seller filtering | PASS | `generateTargetOnlyCandidates` in `src/matching/candidates.ts` |
| Observation timestamps | PASS | `observed_at` required per data contract; used in freshness/staleness logic |
| Freshness handling | PASS | `STALE_RESULT` provider status exists per contract; policy-level freshness is separate (see above) |
| Provider status handling | PASS | `PROVIDER_ERROR` / `PROVIDER_RATE_LIMITED` mapped to `DATA_SOURCE_UNAVAILABLE`/503 in `check-service.ts:217-228` |
| Quota/budget controls | PASS | `src/monitoring/budget.ts` — deterministic monthly budget snapshot, `canConsumeSearches`/`consumeSearches` never silently overspends |
| No direct Target scraping | PASS | No Target-domain fetch anywhere in `src/`; only SerpApi and immersive-product enrichment (still via SerpApi) |
| No discontinued response field dependency | PASS (verified against current SerpApi docs, §10) — code already treats `product_id` as non-authoritative and uses immersive product pages, matching SerpApi's current Google Shopping API surface |
| Sufficient provenance per accepted price | PASS | `matched_product` includes `match_tier`, `match_evidence`, `target_item_id`, `model_number`; response always carries `provider: "SerpApi"`, `price_source_type: THIRD_PARTY_SEARCH_OBSERVATION` |
| SerpApi always described as third-party | PASS | Confirmed across `/health`, `/v1/target-price-check`, UI review page, footer, notices page — see §9 grep results |

**Live SerpApi budget note:** per instruction, this audit spent **zero additional live SerpApi requests**. Existing proof (`docs/proof/live-product-validation/conair-gs14/`, `docs/proof/live-price-reproducibility/`, `docs/proof/usenobu-production/prod-target-price-check.json`) was sufficient to resolve the one material unknown (whether the canonical route has ever produced a live accepted price drop) without spending a new search.

---

## 8. Privacy/security findings

| Check | Status | Evidence |
|---|---|---|
| No Target login anywhere in code/UI | PASS | No credential fields, no Target auth flow found |
| No claim submission | PASS | `ActionCenter.tsx` only opens `target.com/help/contact-us` in a new tab; never posts on the user's behalf |
| No card/bank/password/2FA/wallet-key collection | PASS | Both `/v1/agent` and `/v1/target-price-check` reject payloads containing `password`, `card_number`, `cvv`, `private_key`, `seed_phrase`, `2fa`, `otp` keys pre-schema (`app/v1/agent/route.ts:38-55`, `app/v1/target-price-check/route.ts:62-87`) |
| External text treated as untrusted | PASS | `src/ai/sanitize.ts`; NL purchase text capped at 2000 chars, never stored/logged raw (`docs/nobu-privacy-security-threat-model.md` matches `src/ai/agent-service.ts` behavior — no raw text in audit log) |
| Sensitive data not logged | PASS | `src/a2mcp/audit.ts` — audit ring buffer stores only route/status/outcome/duration, redacts `notes` via `redactSecrets()` |
| Deterministic rules remain authoritative | PASS | AI extraction (`src/ai/*`) never calls matching/policy directly; only `runAgentAction`'s `CHECK_CONFIRMED_PURCHASE` path (deterministic) does |
| Prohibited-language guards | PASS, defense-in-depth | Three independent layers found: (1) Zod-level guard in `src/domain/policy-result.ts:72-82` rejecting `"guaranteed refund"` / `"official target api"` in any disclaimer; (2) `COPY_FORBIDDEN_PATTERNS` regex list in `src/web/action-center.ts:148-160` (also blocks `"we submitted your claim"`, `"automatic refund"`, secret-shaped strings); (3) manual repo grep (see below) found **no** occurrence of forbidden phrases in shipped UI/API copy |

Grep sweep for forbidden claims across `app/` and `src/` (`official Target API`, `guaranteed refund`, `Target owes you`, `refund confirmed`, `Nobu will recover`, `automatic(ally) submit`) found only the **negation** forms ("not an official Target API", "does not guarantee a refund") — i.e., the forbidden claims exist in the codebase only as things being explicitly disclaimed against, never asserted.

No findings under this section.

---

## 9. Submission-proof inventory

| Proof required | Present | Location | Note |
|---|---|---|---|
| Exact source commit | Yes (baseline recorded) | §2 | |
| Deployment URL | Yes | `https://www.usenobu.xyz` | |
| API curl/HTTP proof | Yes | `docs/proof/usenobu-production/prod-health.json`, `prod-target-price-check.json`, `docs/proof/okx/preflight.json` | Dated 2026-07-13/14 — pre-dates current policy staleness; **not evidence the endpoint currently returns a positive result** |
| Official source verification dates | Partially | `docs/external-source-registry.md` | All rows dated 2026-07-13/15; none rechecked since — see §10, §13 |
| Live SerpApi capability audit (redacted) | Yes | `docs/proof/live-product-validation/conair-gs14/`, `docs/proof/live-price-reproducibility/` | Documents the canonical route currently returns `MATCH_REVIEW_REQUIRED`, not an accepted price drop |
| Demo recording + duration | **No** | — | Lane 9 not started |
| ASP listing URL/status | Partial | `docs/proof/okx/README.md` | Status = under review, no public URL |
| X post URL | **No** | — | Lane 9 not started |
| Form confirmation | **No** | — | Lane 9 not started |
| Known limitations documented | Yes | `docs/nobu-current-state.md` "Live price capability notes" section already discloses the capability gap honestly | Good practice — the team has not overclaimed internally |

---

## 10. External official-source verification

Per instruction, only current official sources were treated as authoritative; third-party summaries (including AI-generated web summaries) were not accepted as final authority for OKX rules. Grok was not consulted.

### OKX.AI Genesis Hackathon

- **Attempted:** direct `WebFetch` to `https://web3.okx.com/xlayer/build-x-series` (the `OKX-HACKATHON` source cited in `docs/external-source-registry.md`), `https://web3.okx.com/onchainos/dev-docs/okxai/asp-introduction`, `https://okx.com`, and `https://www.okx.com` — **all failed with DNS resolution errors (`ENOTFOUND`)** from this environment. No `okx.com`/`web3.okx.com` subdomain was reachable in this session.
- **Attempted:** `web.archive.org` snapshot lookup — blocked ("Claude Code is unable to fetch from web.archive.org").
- **Attempted:** the official `XLayerOfficial` X/Twitter post cited by search results — returned HTTP 402 (paywalled/auth-required), unreadable.
- **What was reachable:** `https://www.hackquest.io/hackathons/OKXAI-Genesis-Hackathon` (a hackathon co-host/hosting platform, **not an okx.com-owned domain**) was fetched directly and displays "Submission Deadline: Jul 27th, 23:59 UTC," judging categories matching Nobu's own compliance matrix (Best Product, Lifestyle Companion, Software Utility, etc.), and the same 90-second demo / `#OKXAI` post requirements already in Nobu's docs.
- **WebSearch** (multiple independent result snippets, not a single AI summary) consistently distinguished **two dates**: an ASP/listing submission window of `2026-07-03 00:00 UTC`–`2026-07-17 23:59 UTC` (matching the internal compliance matrix), and a **separate final Google-Form submission deadline of `2026-07-27 23:59 UTC`**.

**Verdict: UNRESOLVED against a primary OKX-owned source.** The July 27 date is corroborated by a plausible official co-host platform and multiple independent search results, but this audit could not reach `okx.com` itself to confirm it as OKX's own canonical statement, and per instruction this report **does not silently replace** the `2026-07-17 23:59 UTC` deadline recorded in `docs/nobu-hackathon-compliance-matrix.md` or `docs/nobu-submission-runbook.md`. Both dates should be treated as live possibilities until someone with network access to `okx.com` archives the actual page. See §13 for the exact registry update required.

### Target price-match policy

- **Attempted:** direct `WebFetch` to `https://www.target.com/help/articles/policies-guidelines/price-match-guarantee` and `https://www.target.com/help/article/000062256` and `https://www.target.com/help/contact-us` — **all returned HTTP 429 (rate-limited/bot-blocked)** in this session, on every retry.
- **Domain-restricted WebSearch** (`site:target.com`) surfaced snippets consistent with the locked contract: 14-day window from original receipt/packing slip, Alaska/Hawaii exclusion for Target.com/app price matches, and — materially — that **Target's actual policy includes a narrower Target Plus provision** (a Target Plus purchase from the last 14 days may match against a now-lower Target.com price for identical items) that Nobu's MVP does **not** implement (Nobu excludes Target Plus entirely). This is flagged in §7 as an intentional scope-narrowing, not a defect, but it means "Nobu's Target Plus exclusion" and "Target's Target Plus policy" are not the same statement and must not be conflated in any listing/demo copy.
- **Verdict:** Content directionally corroborated via search snippets; **not independently re-verified via a direct authoritative fetch this session** because Target's own site blocked the automated fetch. This is itself a real-world illustration of why Nobu correctly refuses to scrape Target directly and instead depends on a third-party observation provider (SerpApi) — see `docs/nobu-retailer-and-price-source-governance.md` "Prohibited methods."

### SerpApi

- **Directly fetched and confirmed:** `https://serpapi.com/legal` — verbatim: "For all recurring plans except the Free, Starter, and Developer plans, SerpApi will assume the liabilities... ('U.S. Legal Shield')" — **matches** the internal contract's claim that Free/Starter/Developer plans have **no** Legal Shield (`docs/nobu-serpapi-data-contract.md:22`). (An initial fetch of `serpapi.com/pricing` alone produced a materially wrong AI summary claiming Legal Shield *is* included on Free — this was superseded by the direct `/legal` fetch and is noted here only as a caution against relying on a single AI-summarized page fetch for legal claims.)
- **Directly fetched and confirmed:** `https://serpapi.com/google-shopping-api` — engine `google_shopping`, parameters `gl`/`hl`/`location`/`device` match `src/serpapi/client.ts` usage; current API surface confirms `product_id` is catalog-based (not TCIN-equivalent) and immersive product pages exist — consistent with why Nobu's matching code (`src/serpapi/immersive.ts`, `src/serpapi/enrich-target-links.ts`) never treats `product_id` as an identifier and instead does one bounded immersive lookup.
- **Verdict:** **Verified current** as of this audit.

---

## 11. Exact blockers

1. **Policy freshness lapse (production-blocking, active now).** `TARGET_US_POLICY.verified_at` is >24h stale; no reverification has occurred since `2026-07-14T20:00:00.000Z` / `docs/nobu-target-policy-contract.md`'s `2026-07-15`. Every confirmed-purchase check on both A2MCP routes currently returns `POLICY_STALE`. Fix is a **policy reverification + timestamp update**, which this lane is explicitly barred from performing (no code/current-state changes in Lane 8R).
2. **OKX listing not approved/public.** Agent `5541` is under review after an avatar-only resubmission; no public listing URL exists. This is outside this lane's authority to resolve (Lane 8R must not resubmit or activate).
3. **Canonical live-price-drop path never proven.** The only historical positive-path proof ran through a removed diagnostic route with a synthetic fingerprint; the canonical route's own live probe returned `MATCH_REVIEW_REQUIRED`. No fixture substitutes for this per the task's own evidentiary rule.
4. **Hackathon deadline ambiguity.** Internal source-of-truth says `2026-07-17 23:59 UTC` (already past as of this audit); external corroboration (non-primary-source) suggests `2026-07-27 23:59 UTC` for the final form. Cannot be resolved without `okx.com` network access.
5. **Lane 9 proof entirely absent.** No demo, no X post, no form confirmation exist yet — expected, since Lane 8 has not closed, but it means the hackathon submission itself has not happened regardless of which deadline is correct.

---

## 12. Exact required repair lanes, ordered by dependency

These are *reported*, not performed, per this lane's audit-only scope.

1. **Lane 8-R1 — Policy reverification (blocking everything else).** Re-check `https://www.target.com/help/articles/policies-guidelines/price-match-guarantee` against an official, reachable network path; update `verified_at` in `src/policy/target-us-policy.ts` and `data/retailer-policies/target-us-v1.yaml`, and reconcile the one-day drift with `docs/nobu-target-policy-contract.md`. Without this, the product cannot return anything but `POLICY_STALE`.
2. **Lane 8-R2 — Canonical live-acceptance proof.** Produce (or attempt and honestly record failure of) a genuine live price-drop acceptance through the **canonical** `/v1/target-price-check` or `/v1/agent` route — not a diagnostic route — for at least one real Target product, after R1 unblocks policy evaluation.
3. **Lane 8-R3 — OKX listing resolution.** Continue monitoring the existing avatar resubmission (agent `5541`) to approval; do not create a new ASP; do not resubmit again while under review, per the existing "do not" list already in `docs/nobu-current-state.md`.
4. **Lane 8-R4 — Deadline reconciliation.** From a network path that can reach `okx.com`/`web3.okx.com`, capture and archive the authoritative current deadline text (whichever it is), and update `docs/external-source-registry.md` per the exact procedure in §13. Until then, treat both `2026-07-17` and `2026-07-27` as live possibilities and do not submit the final form assuming either without reconfirmation.
5. **Lane 9 — Demo and submission closeout.** Only after 1–4 above; unchanged from `docs/nobu-build-order.md`.

---

## 13. Optional ideas (explicitly deferred, not required)

These are *not* required to repair a compulsory requirement, broken promise, or reliability defect, and are listed only to keep them separate from the blockers above per instruction:

- Email alerts (already optional per master spec §6).
- A distributed/shared rate limiter (Redis or edge-based) instead of the current in-process sliding window — worth doing before real production scale, not before the hackathon submission.
- Automating the 24-hour policy-freshness recheck (e.g., a scheduled job that re-fetches and diffs the Target policy page) so the freshness lapse in §1 cannot recur silently. This is an **enhancement to prevent recurrence**, not a requirement of this lane, but it is worth flagging given how directly the manual-recheck cadence failed here.
- Reconciling the Target Plus narrower-MVP-vs-real-policy distinction (§7) into listing/demo copy with an explicit one-line caveat, if judges are expected to know Target policy well enough to notice the difference.

---

## 14. Exact proposed source-of-truth updates

These are **proposals only** — this lane does not modify `docs/nobu-current-state.md`, `docs/nobu-build-order.md`, application code, tests, deployment, or the OKX listing.

1. **`docs/external-source-registry.md`** — add a follow-up row (or amend `OKX-HACKATHON`) once `okx.com`/`web3.okx.com` is reachable:
   - Record the exact deadline text found, verbatim, with URL and check date.
   - If two deadlines are confirmed (ASP listing window vs. final form), add both as distinct rows (e.g., `OKX-HACKATHON-ASP-WINDOW` and `OKX-HACKATHON-FORM-DEADLINE`) rather than overloading one row, since the internal compliance matrix currently conflates them into a single "Submission deadline" line.
   - Do **not** delete or silently overwrite the existing `2026-07-17` entry; add the new finding alongside it with its own check date, per the registry's own change procedure (`docs/external-source-registry.md` "Change procedure").
2. **`docs/nobu-target-policy-contract.md`** and **`src/policy/target-us-policy.ts`** — reconcile the one-day drift between "Last verified: 2026-07-15" (doc) and `verified_at: 2026-07-14T20:00:00.000Z` (code), and perform the actual reverification described in Lane 8-R1 above.
3. **`docs/nobu-hackathon-compliance-matrix.md`** — once the deadline is confirmed from an official source, update the single "Submission deadline" line to distinguish the ASP-listing-submission deadline from the final-form deadline explicitly, so future lanes cannot conflate them the way this audit found them conflated.
4. **`docs/proof/live-price-reproducibility/README.md`** — no change proposed; it is already an honest, correctly fail-closed record and should remain the canonical reference until Lane 8-R2 produces a genuine canonical acceptance.

---

## Final verdict

**`NOBU_LANE_8R_BLOCKED`**

---

## Appendix — commands run

```
git rev-parse HEAD
git status --short
git branch --show-current
git diff --stat / git diff (on the 3 pre-existing modified docs, read-only)
grep sweeps for prohibited language and agent-id duplication (read-only)
WebFetch: web3.okx.com/xlayer/build-x-series (failed, ENOTFOUND)
WebFetch: web3.okx.com/onchainos/dev-docs/okxai/asp-introduction (failed, ENOTFOUND)
WebFetch: okx.com, www.okx.com (failed, ENOTFOUND)
WebFetch: web.archive.org (blocked by tool policy)
WebFetch: x.com/XLayerOfficial/status/... (HTTP 402)
WebFetch: hackquest.io/hackathons/OKXAI-Genesis-Hackathon (succeeded)
WebFetch: target.com price-match / contact-us pages (HTTP 429 on every attempt)
WebFetch: serpapi.com/pricing, serpapi.com/legal, serpapi.com/google-shopping-api (succeeded)
WebSearch: OKX.AI Genesis Hackathon deadline extension July 27 2026
WebSearch: site-restricted okx.com/web3.okx.com deadline query
WebSearch: site-restricted target.com price-match policy query
No application test suite was executed — static inspection and existing committed proof artifacts were sufficient to establish every conclusion above, per the instruction to run only the smallest necessary checks.
```
