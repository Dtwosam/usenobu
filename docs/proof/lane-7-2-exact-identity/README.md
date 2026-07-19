# Lane 7.2 — Exact identity confirmation split

Date: 2026-07-19
Starting HEAD: 847cf210298c0010da17d4b92608a2d7218e212c

## Verdict under test

Local code proof passed before deployment.

## Architecture proven

- User-provided exact Target identity is recorded as `USER_PROVIDED_PURCHASE_IDENTITY`, not as a SerpApi price observation.
- When exact Target URL/TCIN identity is valid and live SerpApi discovery has no strong candidate or is unavailable, Nobu can still show a reviewable identity-only candidate.
- The identity-only candidate has no observed current price.
- Explicit candidate confirmation is still required before fingerprint lock and monitoring.
- Server-side confirmation reloads the stored snapshot, enforces freshness, revalidates the selected candidate against the purchase, and rejects tampered/stale/weak selections.
- Later manual/scheduled checks still use the locked fingerprint against third-party SerpApi observations and fail closed on mismatch or ambiguity.

## Commands run

```text
npm test -- tests/web/candidate-confirmation.test.ts
Result: PASS — 4 tests passed

npm test -- tests/matching/locked-fingerprint-monitor.test.ts
Result: PASS — 9 tests passed

npm test -- tests/monitoring/monitoring.test.ts
Result: PASS — 7 tests passed

npm test -- tests/web/live-discovery.test.ts
Result: PASS — 8 tests passed

npm test -- tests/web/find-product-navigation.test.ts
Result: PASS — 6 tests passed; known cookie-scope stderr in snapshot export test

npm run typecheck
Result: PASS — tsc --noEmit

npm test -- tests/matching/matching.test.ts
Result: PASS — 14 tests passed

npm test -- tests/serpapi/normalize.test.ts
Result: PASS — 10 tests passed

npm test -- tests/serpapi/immersive-enrich.test.ts
Result: PASS — 5 tests passed

npm test -- tests/web/live-manual-check.test.ts tests/web/manual-check.test.ts
Result: PASS — 16 tests passed

npm test
Result: PASS — 40 test files passed; 297 tests passed; 1 skipped

npm run build
Result: PASS — Next.js production build completed successfully

npm run test:e2e -- tests/e2e/consumer-flow.spec.ts
Result: PASS — 10 Playwright tests passed

git diff --check
Result: PASS — no whitespace errors; Git emitted LF-to-CRLF working-copy warnings only
```

## Bounded proof case

Fixture/local proof used Apple AirTag as a proof case only, not as hardcoded behavior:

- Target URL: `https://www.target.com/p/apple-airtag-bluetooth-tracker/-/A-54191097`
- TCIN: `54191097`
- Purchase price: `$35`
- Live discovery unavailable / no strong provider candidate path: identity-only candidate remains confirmable after explicit review.
- Later matching Target observation at `$29.99` creates one alert only after confirmation.

## Negative preservation

Existing tests continue to reject:

- non-Target sellers;
- Target Plus;
- wrong model;
- wrong TCIN / variant conflicts;
- title-only candidates;
- stale candidate snapshots;
- tampered candidate IDs;
- ambiguous later monitoring observations.

## Production proof

To be filled by the unique Vercel deployment proof after the committed source is pushed and deployed. The production proof must not promote `usenobu.vercel.app` or remove any legacy alias in Lane 7.2.
