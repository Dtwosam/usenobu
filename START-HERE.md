# AfterBuy Source-of-Truth Pack v1

**Prepared:** 2026-07-13  
**Project:** AfterBuy  
**Hackathon:** OKX.AI Genesis Hackathon  
**Current product decision:** Target.com price-drop monitoring through SerpApi, with a free A2MCP check endpoint and a small consumer web app.

## What AfterBuy is

AfterBuy lets a user add a recent eligible Target.com purchase once. It checks a third-party shopping data source for a lower Target online price during Target's 14-day adjustment window and alerts the user when they may be able to request the difference.

AfterBuy does **not** guarantee a refund, submit a claim, log into Target, or claim its observed price is an official Target API price. Target verifies the price and makes the final decision.

## Mandatory source stack

Read these in order before planning or changing code:

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
12. `docs/afterbuy-privacy-security-threat-model.md`
13. `docs/afterbuy-submission-runbook.md`
14. `docs/external-source-registry.md`

## Source precedence

When sources conflict, use this order:

1. Current official external rules, policies, terms, and API documentation
2. `docs/afterbuy-clean-master-spec.md`
3. `docs/afterbuy-current-state.md`
4. Compliance and governance documents
5. Policy/data contracts and OpenAPI contract
6. Active build order
7. Tests and proof plan
8. README, prompts, demo copy, and comments

Dynamic external facts must be rechecked against the official URL before they are changed in the repository.

## Important current caveats

- Target allows qualifying price-adjustment requests within 14 days, but Target makes the final decision.
- Target requires an identical item and valid current price; screenshots are not accepted as proof at the store.
- The MVP supports Target.com purchases in supported U.S. locations and excludes Target Plus, Alaska, and Hawaii.
- SerpApi is a third-party observation source. The free plan currently advertises 250 searches per month.
- SerpApi's U.S. Legal Shield is not included with the Free, Starter, or Developer plans.
- No price result is accepted unless the Target seller and exact product match pass the fail-closed matching contract.
- Marketplace/wallet/payment actions must follow OKX eligibility rules. Never bypass age, identity, location, or guardian requirements.

## Tool responsibilities

- **ChatGPT:** product, architecture, lane coordination, source-of-truth management, and review. Upload `AFTERBUY_CHATGPT_PROJECT_SOURCE.md` and paste `CHATGPT_PROJECT_INSTRUCTIONS.md` into Project instructions. Modular files may also be uploaded as sources.
- **Grok Build:** primary repository implementation and test execution, lane by lane. Follow `AGENTS.md` and `prompts/GROK_BUILD_LANE_PROMPT_TEMPLATE.md`.
- **Regular Grok research:** current public discussion, competition, and external-change research only, using `prompts/GROK_RESEARCH_VERIFICATION_PROMPT.md`. Regular Grok research does not implement product code and does not override official sources.
- **Official Target, OKX, and SerpApi sources** remain authoritative for external facts. Dynamic external facts must be rechecked against the official URL before repository changes.
- **Claude/Codex (optional fallback only):** not the active AfterBuy implementation workflow. If needed, use `prompts/CLAUDE_CODEX_LANE_PROMPT_TEMPLATE.md` under the same hard locks.
