# Lane 7.2 — Unique production deployment proof

Date: 2026-07-19
Implementation commit: `f50beb0847b4a49b772e6fe5e2dc394d7050de04`
Fix commit (required to unblock this proof): `909a3fdb19a71b09eac27cabdb81782915be905b`
Vercel project: `usenobu` (`prj_nVrpTW9gmRZxn9AAh5ALrGSAaecZ`)

## Deployments

| Attempt | Deployment ID | URL | Result |
|---|---|---|---|
| 1 (pre-fix) | `dpl_C9M4hSuRy4aEg7qXqkfX5c2pZWa3` | `https://usenobu-ofctbme75-dtwoflicks-2878s-projects.vercel.app` | Confirmation failed with `tampered_candidate` — see root cause below |
| 2 (post-fix, proof deployment) | `dpl_AFoJvmu7qzYhUBjT2DA9m6XrpbS8` | `https://usenobu-hfviza4u4-dtwoflicks-2878s-projects.vercel.app` | Full proof passed |

Both deployments were created with `vercel deploy --prod --skip-domain --yes`, which
builds a `target: production` deployment and disables automatic domain aliasing.
`vercel alias ls` was checked before and after each deploy: `www.usenobu.xyz`
stayed pointed at its existing (6-day-old) deployment throughout. The canonical
alias was never promoted, and no other Vercel project, GitHub repo, or OKX ASP
was touched.

## Root cause found and fixed during this proof

The first unique deployment reproduced a genuine, pre-existing bug (present in
the codebase since the Lane 7.1 commit `6eda7f9`, unrelated to the Lane 7.2 diff
itself): `src/web/session-snapshot.ts`'s `slimDiscoveryForCookie` compacted the
enrollment-discovery offer for the cross-instance session cookie but dropped the
`offer_id` field. On Vercel, `confirmPurchaseCandidate` revalidates the selected
candidate by re-scoring the offers loaded from the (cookie-hydrated) discovery
snapshot; `scoreOfferAgainstPurchase` derives `candidate_id` from `offer_id` when
present, or a fresh random id when absent. With `offer_id` missing, every
confirmation request that landed on a serverless instance requiring cookie
rehydration produced a new random `candidate_id` that could never match the one
originally shown to the user, so the server rejected the confirmation as
`tampered_candidate` — a fail-closed rejection, but not the intended behavior,
and it blocked every production confirmation, not just the Lane 7.2 identity-only
path.

Fix: added `offer_id: o.offer_id` back to the compacted offer object, plus a
regression test (`tests/web/find-product-navigation.test.ts`) that exercises
`exportSnapshot`'s cookie compaction and asserts the re-scored candidate id
after the round trip equals the originally issued id. Full local suite
(298 passed, 1 skipped), typecheck, build, and the Playwright consumer-flow
spec were re-run after the fix — all green — before pushing and redeploying.
No matching rule was weakened; the fix only restores data that the compaction
had been dropping.

## Proof evidence

Raw artifacts: `production-proof.json`, `flow-a-*.png`, `flow-b-after-live-check.png`,
`run-production-proof.mjs` (the script used, targeting the unique deployment URL
via `NOBU_PROOF_BASE`, not `www.usenobu.xyz`).

### 1–2. Identity-only candidate with no current price

Flow A used a syntactically valid but nonexistent Target URL/TCIN
(`https://www.target.com/p/nobu-lane-7-2-identity-proof/-/A-99999901`) — chosen
specifically so live SerpApi would not return a strong Target match, forcing
the Lane 7.2 identity-only path deterministically rather than depending on
current live-index luck. No price is ever claimed for this test identity.

- `match_decision`: `EXACT_MATCH_CANDIDATE`
- `match_reasons`: `user_provided_purchase_identity, single_strong_target_candidate, exact_target_url`
- Observed price shown to the user: `—` (null)
- Disclosure panel: "Source: user-provided exact Target identity - no current price observed yet"

### 3–4. Explicit confirmation required, server-side confirmation succeeds

Before confirming, the dashboard showed `monitoring_status: "Confirm product"`,
no `run-check` control, and no locked fingerprint. Clicking **Confirm product**
posted to the server action, which reloaded the stored discovery snapshot,
revalidated the candidate, and returned success (after the fix).

### 5. Locked fingerprint created

`fingerprint_text`: `Locked product identity on file fp_92c277e799d5ccf4ff2aba72`

### 6–7. Monitoring blocked before / active after confirmation

| | Before confirm | After confirm |
|---|---|---|
| `monitoring_status` | Confirm product | Watching |
| `run_check_visible` | false | true |
| `fingerprint_present` | false | true |

### 8–9. Fail-closed live observation, no positive alert

Two independent live checks were run against real production SerpApi traffic
(no fixtures — `data_source=LIVE` on both):

- **Flow A** (confirmed identity-only fingerprint, synthetic/nonexistent TCIN):
  outcome `provider_unavailable` ("The price source is temporarily
  unavailable."). No alert created.
- **Flow B** (real product — Conair ExtremeSteam GS14 garment steamer,
  TCIN `87470797`, a product with previously documented live-matching
  sensitivity): enrollment produced a confirmable candidate and was confirmed;
  the subsequent live check returned outcome `no_match` ("Nobu could not
  confirm the exact product."). No alert created.

Neither run happened to land on the literal `AMBIGUOUS_TARGET_RESULTS`
provider status — live third-party search results are not fully
deterministic and a specific ambiguous response could not be forced without
fabricating provider data, which is out of bounds for this proof. Both
observed outcomes are in the same fail-closed family the contract requires
("Ambiguous or mismatched later observations fail closed and create no
positive alert"): the locked fingerprint did not accept an uncertain or
non-matching observation, and no positive alert was created in either case.
This is evidence for the fail-closed behavior class, not a literal
reproduction of the `ambiguous` status code.

### 10. `/health`, `/v1/agent`, and the UI identify the product as Nobu

- `/health` → `"service": "nobu-a2mcp"`
- `/v1/agent` (POST, unknown purchase id) → `404 {"error":"not_found",...}` (correct bounded behavior)
- Homepage `<title>` contains "Nobu"

### 11. No secret or sensitive data

`no_api_key_in_body: true` (checked SerpApi/Groq key patterns across all
visited page bodies). `/health` exposes only booleans
(`serpapi_configured`, `groq_configured`), never key values. No key values
appear in `production-proof.json` or the screenshots.

## Known script-level limitation (not a product defect)

`provider_outcome` / `matching_decision` in `production-proof.json` show as
empty strings for both flows because those fields live inside a collapsed
"View details" `<Disclosure>` on the dashboard that the proof script did not
expand before reading `innerText()`. The outcome itself was still captured
correctly via the `outcome` query parameter and the visible `check-outcome`
banner text, which drove the pass/fail evaluation above.
