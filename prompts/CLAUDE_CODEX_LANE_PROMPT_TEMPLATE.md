# Claude/Codex Lane Prompt Template

> **Optional fallback only — not the active AfterBuy implementation workflow.**  
> The primary repository implementation agent is **Grok Build**. Use `prompts/GROK_BUILD_LANE_PROMPT_TEMPLATE.md` for active lanes. Keep this file only if Claude/Codex is used as a temporary fallback under the same hard locks and source stack.

Use this template for one lane at a time when operating as an optional fallback.

---

You are working on **AfterBuy**.

## Active lane

`<LANE NUMBER AND NAME>`

## Goal

`<ONE CLEAR LANE OUTCOME>`

## Mandatory reading

Read in this order before editing:

1. `AGENTS.md`
2. `docs/afterbuy-clean-master-spec.md`
3. `docs/afterbuy-current-state.md`
4. `docs/afterbuy-hackathon-compliance-matrix.md`
5. `docs/afterbuy-retailer-and-price-source-governance.md`
6. `docs/afterbuy-target-policy-contract.md`
7. `docs/afterbuy-serpapi-data-contract.md`
8. `docs/afterbuy-architecture.md`
9. `openapi/afterbuy-a2mcp.openapi.yaml`
10. `docs/afterbuy-build-order.md`
11. `docs/afterbuy-test-and-proof-plan.md`
12. Any lane-specific ADR or source file

Start with and maintain a todo/checklist.

## Hard locks

- Target.com online purchases only.
- Target seller only; no Target Plus.
- U.S. MVP excluding Alaska and Hawaii.
- SerpApi is third-party observed data, never an official Target API price.
- User confirms the exact product once; later matching is fail closed.
- No guaranteed refund language.
- No direct Target scraping, retailer login, or claim submission.
- No secrets in code/logs/output.
- Free A2MCP endpoint before x402.
- Do not add another retailer.
- Do not fabricate live proof.

## Allowed scope

`<EXACT FILES/COMPONENTS ALLOWED>`

## Required checks

1. Inspect current repository state and relevant files.
2. Run the smallest targeted checks first.
3. Stop on the first failure and repair it.
4. Add/update tests required by the source contracts.
5. Run the lane proof.
6. Update `docs/afterbuy-current-state.md` only with proven facts.
7. Do not commit or tag unless explicitly instructed.

## Final report

Return:

- todo status;
- what changed;
- files changed;
- tests/commands and exact outcomes;
- live vs fixture proof distinction;
- blockers and risks;
- source-of-truth updates;
- git status;
- exact next lane.

Do not begin work outside this lane.
