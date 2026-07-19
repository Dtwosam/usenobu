# Nobu identity release — resume from unique-deployment gate

Date: 2026-07-19
Starting point: `NOBU_LANE_7_2_PASS` (implementation `f50beb0`, fix `909a3fd`, proof/status `e927b07`)

## Verdict

**NOBU_IDENTITY_RELEASE_PASS.**

## Preflight reconciliation

- Repo root: `C:\Users\dtwof\Desktop\AfterBuy`, branch `master`, working tree clean.
- Local HEAD == `origin/master` HEAD == `e927b07e2f068ea83c4ded65cd21fa3b20d7e842`.
- Resolved fragment hashes from the prior report, all on a single linear chain
  `847cf21 → f50beb0847b4a49b772e6fe5e2dc394d7050de04 → 909a3fdb19a71b09eac27cabdb81782915be905b → e927b07e2f068ea83c4ded65cd21fa3b20d7e842` (= HEAD):
  - `f50beb0847b4a49b772e6fe5e2dc394d` resolves uniquely to `f50beb0847b4a49b772e6fe5e2dc394d7050de04`.
  - `909a3fdb19a71b09eac27cabdb81782915be905b` is a full hash, confirmed a real commit.
  - `e927b07e2f068ea83c4ded65cd2` resolves uniquely to `e927b07e2f068ea83c4ded65cd21fa3b20d7e842`.
  - The reported "final HEAD beginning `a3b20d7e842`" is the tail of that same `e927b07…` hash — all four fragments name the same three-commit chain, in the order shown, with `e927b07…` as current HEAD.
- `git grep -il afterbuy` and `git ls-files | grep -i afterbuy`: both empty (zero matches).

## Unique deployment reconciliation

The originally-reported unique deployment (`dpl_C9M4hSuRy4aEg7qXqkfX5c2pZWa3` /
`usenobu-hfviza4u4-…`) was built from commit `909a3fd`, one commit behind final
HEAD `e927b07` (the difference is docs-only — see `git show --stat e927b07`,
which touches only `docs/`). To remove any ambiguity about "exact clean final
HEAD," a **fresh** unique deployment was built directly from the verified
clean `e927b07` working tree instead of reusing the older one:

| Field | Value |
|---|---|
| Deployment ID | `dpl_DQ9ULj9uukY1Kdtujxqkf8sppeUw` |
| URL | `https://usenobu-e9qrs4dfi-dtwoflicks-2878s-projects.vercel.app` |
| Project | `usenobu` (`prj_nVrpTW9gmRZxn9AAh5ALrGSAaecZ`) |
| Target | `production` |
| Status | `READY` |
| Created | `2026-07-19T20:59:12Z` (per `vercel inspect`, "12 GMT+0100") |
| Aliases at creation | none (project-scoped auto aliases only; `--skip-domain` prevented `usenobu.vercel.app` promotion) |

**Deployed commit SHA caveat:** this project deploys via the Vercel CLI
(`vercel deploy`), not a GitHub-linked auto-deploy integration, so
`vercel inspect --format json` does not carry a `gitSource`/commit-SHA field
for this deployment (confirmed: its JSON keys are only
`id, name, url, target, readyState, createdAt, aliases, builds, contextName`).
Correspondence to `e927b07` is procedural, not metadata-attested: `git status`
was verified clean at `e927b07` immediately before running
`vercel deploy --prod --skip-domain --yes`, with no intervening working-tree
changes between the git check and the deploy command.

## Production verification (pre-promotion, against the unique URL)

See `unique-deployment-pre-promotion/production-proof.json` and its
screenshots. All required checks passed against
`https://usenobu-e9qrs4dfi-dtwoflicks-2878s-projects.vercel.app`:

- `/health` → 200, `service: "nobu-a2mcp"`.
- `/v1/agent` (POST, unknown purchase id) → 404 with valid JSON body (correct bounded behavior).
- Homepage `<title>` contains "Nobu" only.
- Exact synthetic Target URL/TCIN → `EXACT_MATCH_CANDIDATE`, reason `user_provided_purchase_identity`, observed price `—` (null).
- Confirmation required (no check control / no fingerprint pre-confirm) and succeeded server-side.
- Locked fingerprint persisted (`fp_cf00211469318ef07f6609b4`).
- Monitoring blocked before confirmation, available after.
- Two live (non-fixture) observations, both fail-closed with no alert: synthetic identity check → `provider_unavailable`; real product (Conair GS14) check → `no_match`. **Exact statuses reported as received — neither was literally "ambiguous"; no ambiguous status was claimed.**
- No secret/key value in any visited page body.

## Canonical promotion

`vercel promote` reported project-level success but `usenobu.vercel.app`
(a manually-pinned alias, not the domain-follows-production default) did not
move — confirmed via `vercel promote status usenobu` (pointed at the new
deployment) vs `vercel inspect https://usenobu.vercel.app` (still showing the
prior deployment `dpl_6PZZLMzzyJriQjJQH1hbpbpjr9i1`). Repointed explicitly
with `vercel alias set https://usenobu-e9qrs4dfi-… usenobu.vercel.app`, then
verified `vercel inspect https://usenobu.vercel.app` resolves to
`dpl_DQ9ULj9uukY1Kdtujxqkf8sppeUw` — the exact verified deployment.

## Canonical production proof

Re-ran the full bounded proof through `https://usenobu.vercel.app` itself
(see `canonical-promotion/production-proof.json` and screenshots) — identical
pass results to the pre-promotion run (identity-only candidate, confirmation,
locked fingerprint `fp_400beee6d2220f6217825ba1`, monitoring gate, fail-closed
live observations `provider_unavailable` / `no_match`, no alert, no secrets).
A live scan of the canonical homepage and `/notices` page for the prior
"afterbuy" brand string returned zero matches.

## ASP #5541 inspection (read-only)

See `asp-5541-status-redacted.json`. Queried via `onchainos agent get-agents
--agent-ids 5541` and `onchainos agent service-list --agent-id 5541` — no
create/update/resubmit call was made.

| Field | Value |
|---|---|
| Agent ID | `#5541` |
| Name | Nobu |
| Role | ASP |
| Status | `not listed` (not publicly live) |
| Approval status | `2` — "Listing under review" |
| Reviewer feedback | Same avatar-dimensions/rounded-corners text from the original rejection cycle; no new remark posted since the 2026-07-17 avatar-only resubmission (expected while a decision is pending) |
| Service | "Post-checkout price watch", A2MCP, fee `0` (free, unchanged) |
| Endpoint | `https://usenobu.vercel.app/v1/agent` — already the canonical URL, no legacy-alias dependency |

No edit was necessary or performed.

## Legacy alias retirement

Before removal, `afterbuy.vercel.app` was found to **already** resolve to the
newly-promoted deployment (`usenobu-e9qrs4dfi-…`) — it appears to be a
domain that auto-follows the project's current production deployment (unlike
`usenobu.vercel.app`, which required the explicit `alias set` above). This is
distinct from `nobu-app.vercel.app`, `get-nobu.vercel.app`,
`nobu-watch.vercel.app`, `nobu-price.vercel.app`, and `nobu-mvp.vercel.app`,
which remained pinned to the old `afterbuy-hvj2pbrmg-…` deployment throughout
and were **not** touched.

Removed with `vercel alias remove afterbuy.vercel.app --yes`. Verified after:

- `afterbuy.vercel.app` no longer appears in `vercel alias ls` and now returns HTTP 404.
- `usenobu.vercel.app/health` → 200, correct body.
- `usenobu.vercel.app/v1/agent` (POST, unknown id) → 404 (correct bounded behavior, endpoint functional).
- ASP #5541 unchanged (no edit performed as part of this step).
- `vercel project ls` shows exactly one `usenobu` project — no duplicate.
- `nobu-app.vercel.app`, `get-nobu.vercel.app`, `nobu-watch.vercel.app`, `nobu-price.vercel.app`, `nobu-mvp.vercel.app` all still present, unchanged.

## Lane status

Lane 8 remains **PENDING_REVIEW** — ASP #5541's `approvalStatus` is still `2`
("Listing under review") and `status` is "not listed." No public/live listing
evidence exists. Lane 8 is not marked PASS.
