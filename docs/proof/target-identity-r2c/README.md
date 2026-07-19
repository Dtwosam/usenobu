# Target Identity R2C Proof

Lane: 8-R2C - Target URL Identity and Product Discovery Reliability
Started from: `aaf632cba7181056b2bcd6d606ae2ccbe48acc16`
Branch: `master`

## Local implementation proof

Implemented:

- deterministic Target URL parser with normalized URL, TCIN, bounded slug tokens, original URL output, and explicit reason codes;
- initial browser enrollment requiring only Target URL, purchase price, and purchase date;
- optional TCIN/model/UPC fields as progressive fallback details;
- URL-derived TCIN and slug product name passed into the existing SerpApi discovery cascade;
- governed query parity through `buildMonitorShoppingQuery`;
- fail-closed matching, seller, Target Plus, ambiguity, accessory, wrong-model, and Google product-id guards preserved.

Pre-existing dirty files were preserved and not edited for this lane:

- `docs/nobu-build-order.md`
- `docs/nobu-current-state.md`
- `docs/proof/okx/README.md`
- `docs/proof/policy-operations-r1a/README.md`
- untracked OKX proof artifacts under `docs/proof/okx/`

## Tests

Targeted results captured during implementation:

- `npm test -- tests/web/exact-identity.test.ts tests/web/live-discovery.test.ts` - pass, 14 tests.
- `npm test -- tests/a2mcp/a2mcp.test.ts tests/matching/matching.test.ts tests/matching/locked-fingerprint-monitor.test.ts tests/web/find-product-navigation.test.ts` - first run failed on stale copy assertion, then pass, 43 tests.
- `npm test -- tests/ui/manual-entry-disclosure.test.ts tests/ui/positioning.test.ts tests/web/exact-identity.test.ts tests/web/live-discovery.test.ts tests/web/find-product-navigation.test.ts` - pass, 30 tests.
- `npm run typecheck` - first run failed on test stub typing, then pass.
- `npm test -- tests/web/live-manual-check.test.ts` - first targeted batch exposed temporal drift in the test/runtime handoff; after propagating `now` into `runLivePriceCheck`, pass, 7 tests.
- `npm test -- tests/web/exact-identity.test.ts tests/web/live-discovery.test.ts tests/web/manual-check.test.ts tests/web/live-manual-check.test.ts tests/matching/matching.test.ts tests/matching/dedup-candidates.test.ts tests/matching/locked-fingerprint-monitor.test.ts tests/serpapi/immersive-enrich.test.ts tests/a2mcp/a2mcp.test.ts tests/ui/manual-entry-disclosure.test.ts tests/web/find-product-navigation.test.ts` - pass, 86 tests.
- `npm run typecheck` - pass.
- `git diff --check -- <Lane 8-R2C files>` - pass.
- `git diff --check` - blocked by pre-existing trailing whitespace in off-limits dirty files:
  - `docs/nobu-current-state.md:3`
  - `docs/nobu-current-state.md:4`
  - `docs/proof/okx/README.md:3`
- R2C.0 reconciliation commit `fd5834d655d76c4ac42bfe63bec00a7bc952e046` cleared the pre-existing diff-check blocker.
- `git diff --check` - pass.
- `npm run build` - pass. Next.js 15.5.20 compiled successfully and generated 15 app routes.
- `npx.cmd playwright test tests/e2e/consumer-flow.spec.ts` - 10 tests reported `ok`; the runner did not return after all tests reported success, with no server left listening on port 3456.

## Live proof

Production deployment:

- Deployment id: `dpl_7P6rUDeGfASGkKiS4jN1qby51hX3`
- Deployment URL: `https://usenobu-ngtiamvqr-dtwoflicks-2878s-projects.vercel.app`
- Vercel inspector: `https://vercel.com/dtwoflicks-2878s-projects/usenobu/7P6rUDeGfASGkKiS4jN1qby51hX3`
- Primary `usenobu.vercel.app` alias was not moved because the live enrollment proof did not pass.

Health and regression proof:

- `GET /health` returned `status: ok`, `serpapi_configured: true`, `provider_ready: true`, `policy_review_state: CURRENT`, and `policy_ops_store_kind: postgres`.
- `POST /v1/agent` with `CHECK_MONITORING_STATUS` for a missing purchase returned 404 `not_found`, preserving backward-compatible behavior.

Bounded provider proof:

- Script: `run-production-proof.mjs`
- Output: `production-proof.json`
- Screenshots: `prod-review-airtag.png`, `prod-confirmed-airtag.png` when confirmation exists.
- SerpApi budget: one live enrollment discovery path reached production SerpApi; browser proof cannot directly observe server-side search count. Code-path bound is one Google Shopping search plus at most one Immersive Product enrichment. The recorded upper bound is 2, below the max of 3.

Result:

- Fallback/retry preservation: pass. A valid Target URL with unsupported `AK` region returned a clear unsupported-state message, preserved purchase price/date, and did not use provider search.
- Negative fail-closed: pass. A non-Target URL was blocked before submit with a Target URL reason and no provider search.
- URL + price + date AirTag enrollment: blocked by provider evidence. The live path used Target URL containing `A-54191097`, derived TCIN `54191097`, supplied no model or UPC, and returned `data_source: LIVE`, but the discovery result was `MATCH_REVIEW_REQUIRED` with `no_strong_match`, zero candidate rows, and no confirmable product.

Verdict: `NOBU_LANE_8_R2C_BLOCKED_PROVIDER_CAPABILITY`.

No Agent `5541` update, OKX listing edit/resubmit, Target scraping, account login, claim submission, or additional retailer exposure occurred.

## R2C.1 diagnostic follow-up

Started from: `fd5834d655d76c4ac42bfe63bec00a7bc952e046`
Final preview deployment: `dpl_6hK1XgUQW226dvsMBfp9iBf24DJU`
Preview URL: `https://usenobu-9ph12y879-dtwoflicks-2878s-projects.vercel.app`

Patch:

- added proof-safe SerpApi normalization counts;
- added query strategy identifiers from the existing governed monitor query builder;
- added discovery diagnostics with exact provider-call count, enrichment use, candidate counts, strong-candidate counts, and bounded rejection reason counts;
- persisted diagnostics in enrollment discovery and cookie snapshots;
- exposed diagnostics on the review page as hidden proof metadata only;
- repaired live zero-candidate discovery to persist and route to review/fallback instead of returning a premature form-level `no_reliable_target` error.

Local verification:

- `npm test -- tests/serpapi/normalize.test.ts tests/web/live-discovery.test.ts` - pass, 18 tests.
- R2C targeted suite - pass, 69 tests.
- `npm test` - pass, 292 tests, 1 skipped.
- `npm run typecheck` - pass.
- `npm run build` - pass.
- `npx.cmd playwright test tests/e2e/consumer-flow.spec.ts --grep "allows URL-only identity|add-purchase validation preserves values|ambiguous fixture path cannot confirm"` - pass, 3 tests; local Playwright web server required manual process cleanup after reporting success.
- `git diff --check` - pass.

Preview proof:

- Script: `run-production-proof.mjs`
- Output: `production-proof.json`
- Screenshot: `prod-review-airtag.png`
- Health: preview returned `status: degraded`, `serpapi_configured: false`, and no PostgreSQL policy operations store.
- A2MCP regression: `POST /v1/agent` missing purchase remained `404 not_found`.
- AirTag URL-only path reached review/fallback with `data_source: LIVE`, `MATCH_REVIEW_REQUIRED`, `no_target_candidates`, and no confirmable candidate.
- Exact provider calls consumed: `0`.
- Diagnostics: `shopping_results_count: 0`, `target_source_results_count: 0`, `immersive_enrichment_used: false`, `normalized_candidates_count: 0`, `strong_candidates_count: 0`, `query_strategy_identifier: title_slug_primary`, `primary_cause: NO_SHOPPING_RESULTS`.
- Negative non-Target URL remained blocked before submit with zero provider calls.
- Progressive model/UPC fallback was not attempted because no verified user-provided model number or UPC/GTIN was supplied; Nobu did not guess an identifier.

R2C.1 verdict: `NOBU_LANE_8_R2C_BLOCKED_IDENTITY_INPUT`.

No production alias was moved. No Agent `5541` update, OKX listing edit/resubmit, Target scraping, account login, claim submission, or additional retailer exposure occurred.

## R2C.2 corrected identity proof attempt

Started from: `fd5834d655d76c4ac42bfe63bec00a7bc952e046`

Corrected proof identity:

- Product: Apple AirTag, 1 Pack, 2nd generation.
- Target URL: `https://www.target.com/p/-/A-85990992`.
- TCIN: `85990992`.
- Purchase price input for proof: `$35.00`.
- Purchase date input for proof: `2026-07-18`.
- Progressive fallback identifier: UPC `195950******` (redacted).
- Optional hardware-model diagnostic only: `A2937`.

The earlier AirTag proof input using TCIN `54191097` is invalid for this lane because that Target identity resolves to Apple AirPods (2nd generation), not the AirTag proof product. The product name and Target identity conflicted; fail-closed behavior was correct.

Production-target deployment attempted:

- Deployment id: `dpl_2oZ9MRN4qGTuREC89wn82Vrz91at`.
- Deployment URL: `https://usenobu-bev5dnb2q-dtwoflicks-2878s-projects.vercel.app`.
- Vercel inspector: `https://vercel.com/dtwoflicks-2878s-projects/usenobu/2oZ9MRN4qGTuREC89wn82Vrz91at`.
- CLI production deployment created the project-scoped Vercel alias, but the canonical `usenobu.vercel.app` alias was not intentionally moved after the proof failed.

Bounded live result:

- Script: `run-production-proof.mjs`.
- Output: `production-proof.json`.
- Screenshot: `prod-review-airtag.png`.
- Provider budget: 2 SerpApi calls maximum for R2C.2 proof.
- Provider calls consumed: exactly 2 from proof-safe server-rendered diagnostics.
- URL-only discovery extracted TCIN `85990992` and reached review/fallback.
- URL-only discovery result: `MATCH_REVIEW_REQUIRED`, `no_strong_match`, `IDENTITY_EVIDENCE_INSUFFICIENT`.
- Diagnostic counts: 40 shopping results, 30 Target-source results, 30 normalized candidates, 0 strong candidates.
- Immersive enrichment was used by the deployed code before fallback input was supplied, consuming the second provider call and blocking the UPC fallback attempt.
- Cookie snapshot also compacted non-exact live candidates to zero rows even though diagnostics recorded 30 normalized candidates.
- Negative non-Target URL remained blocked before submit with zero provider calls.

Post-proof source repair:

- `src/web/live-discovery.ts` now skips Immersive enrichment for URL-only discovery unless model or UPC/GTIN fallback identity is present. This preserves the second provider-call slot for progressive fallback.
- `src/web/session-snapshot.ts` now preserves up to two compact non-exact review candidates when no exact candidate exists, while continuing to strip raw provider payloads.
- `src/matching/evaluate.ts` rejects exact Target URL/TCIN candidates when the supplied product title strongly conflicts with the identifier-backed offer title.

Post-repair local verification:

- `node --check docs\proof\target-identity-r2c\run-production-proof.mjs` - pass.
- `npm test -- tests/web/live-discovery.test.ts tests/web/find-product-navigation.test.ts tests/matching/matching.test.ts` - pass, 28 tests.
- R2C targeted suite - pass, 102 tests.
- `npm run typecheck` - pass.
- `npm run build` - pass. Next.js 15.5.20 compiled successfully and generated 15 app routes.
- `npx.cmd playwright test tests/e2e/consumer-flow.spec.ts --grep "allows URL-only identity|add-purchase validation preserves values|ambiguous fixture path cannot confirm"` - 3 tests passed; local Playwright server required single-PID cleanup after reporting success.
- `git diff --check` - pass.

Production checks after the failed proof:

- Direct deployment `/health`: `status: ok`, `provider_ready: true`, `policy_review_state: CURRENT`, `policy_ops_store_kind: postgres`.
- `https://usenobu.vercel.app/health`: `status: ok`, `provider_ready: true`, `policy_review_state: CURRENT`, `policy_ops_store_kind: postgres`.
- `POST /v1/agent` missing monitoring-status purchase remains 404 `not_found`.

R2C.2 verdict: `NOBU_LANE_8_R2C_BLOCKED_PROVIDER_CAPABILITY`.

No additional live provider call was made after the source repair because the bounded R2C.2 proof budget had already been consumed. No Agent `5541` update, OKX listing edit/resubmit, Target scraping, account login, claim submission, or additional retailer exposure occurred.
