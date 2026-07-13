# AGENTS.md — Nobu

## Mandatory reading order

Before planning, auditing, implementing, testing, documenting, or closing a lane, read:

1. `docs/nobu-clean-master-spec.md`
2. `docs/nobu-current-state.md`
3. `docs/nobu-hackathon-compliance-matrix.md`
4. `docs/nobu-retailer-and-price-source-governance.md`
5. `docs/nobu-target-policy-contract.md`
6. `docs/nobu-serpapi-data-contract.md`
7. `docs/nobu-architecture.md`
8. `openapi/nobu-a2mcp.openapi.yaml`
9. `docs/nobu-build-order.md`
10. `docs/nobu-test-and-proof-plan.md`
11. `docs/nobu-privacy-security-threat-model.md`
12. `docs/nobu-submission-runbook.md`
13. `docs/external-source-registry.md`

The active build order is `docs/nobu-build-order.md`.

## Execution discipline

- Start each lane with a todo/checklist and keep it updated.
- Inspect the repository and current state before editing.
- Work only on the active lane. Do not skip lanes or silently expand scope.
- Run the smallest relevant tests first. Stop on the first failure, diagnose it, and repair before widening test scope.
- Do not run destructive commands or touch production data without explicit instruction.
- Keep secrets in environment variables and never commit them.
- Commit only lane-specific files when asked. Do not tag unless explicitly asked.
- Final report must include changed files, tests and outputs, proof, remaining blockers, and the exact next lane.

## Hard product locks

- MVP retailer: Target only.
- MVP purchase channel: Target.com / Target online purchase only.
- Supported geography: U.S. excluding Alaska and Hawaii unless the official policy is later verified to permit it.
- Target Plus is excluded from the MVP.
- Price source: SerpApi Google Shopping result filtered and matched to Target.
- SerpApi is third-party observed data, not an official Target API.
- The user confirms the exact matched product once before monitoring begins.
- All later checks must use the locked product fingerprint.
- Exact matching is fail closed. Ambiguous matches return `MATCH_REVIEW_REQUIRED` or `NO_RELIABLE_PRICE`.
- Target makes the final adjustment decision.
- Never guarantee a refund.
- No direct Target scraping.
- No retailer account login.
- No claim submission.
- No card, banking, ID-document, wallet-key, password, or 2FA collection.
- No fake live data, refunds, orders, users, reviews, or hackathon approvals.
- Free A2MCP endpoint first. x402 is optional only after the free service is stable and listed.
- Do not add another retailer before the Target MVP closeout.

## AI boundary

AI may:

- parse natural-language purchase descriptions and receipt/order text;
- extract candidate purchase fields and product identifiers (never invent them);
- flag missing or uncertain fields for user review;
- explain results in plain English;
- draft a user-facing reminder or claim checklist.

AI may not:

- invent Target rules, prices, dates, models, or identifiers;
- override deterministic matching or eligibility;
- convert ambiguous evidence into a confirmed match;
- start monitoring or lock a fingerprint without user confirmation;
- guarantee a price adjustment;
- rewrite price/source provenance.
