# Nobu Source-of-Truth Pack v1

**Prepared:** 2026-07-13  
**Project:** Nobu  
**Hackathon:** OKX.AI Genesis Hackathon  
**Current product decision:** Universal post-purchase price-monitoring platform; first live retailer is Target.com (SerpApi third-party observation), free A2MCP check endpoint, small consumer web app.

## What Nobu is

Nobu is a post-purchase price-monitoring platform that watches supported purchases for possible retailer price drops. The current live integration supports eligible Target.com purchases.

Add a supported purchase once. Nobu watches the retailer price during the applicable monitoring window and alerts you when there may be a difference to request.

Nobu does **not** guarantee a refund, submit a claim, log into retailer accounts, or claim observed prices are official Target API prices. For Target purchases, Target verifies the price and makes the final decision. Other retailers remain unsupported until separately integrated.

## Mandatory source stack

Read these in order before planning or changing code:

1. `AGENTS.md`
2. `docs/nobu-clean-master-spec.md`
3. `docs/nobu-current-state.md`
4. `docs/nobu-hackathon-compliance-matrix.md`
5. `docs/nobu-retailer-and-price-source-governance.md`
6. `docs/nobu-target-policy-contract.md`
7. `docs/nobu-serpapi-data-contract.md`
8. `docs/nobu-architecture.md`
9. `openapi/nobu-a2mcp.openapi.yaml`
10. `docs/nobu-build-order.md`
11. `docs/nobu-test-and-proof-plan.md`
12. `docs/nobu-privacy-security-threat-model.md`
13. `docs/nobu-submission-runbook.md`
14. `docs/external-source-registry.md`

## Source precedence

When sources conflict, use this order:

1. Current official external rules, policies, terms, and API documentation
2. `docs/nobu-clean-master-spec.md`
3. `docs/nobu-current-state.md`
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

- **ChatGPT:** product, architecture, lane coordination, source-of-truth management, and review. Upload `NOBU_CHATGPT_PROJECT_SOURCE.md` and paste `CHATGPT_PROJECT_INSTRUCTIONS.md` into Project instructions. Modular files may also be uploaded as sources.
- **Grok Build:** primary repository implementation and test execution, lane by lane. Follow `AGENTS.md` and `prompts/GROK_BUILD_LANE_PROMPT_TEMPLATE.md`.
- **Regular Grok research:** current public discussion, competition, and external-change research only, using `prompts/GROK_RESEARCH_VERIFICATION_PROMPT.md`. Regular Grok research does not implement product code and does not override official sources.
- **Official Target, OKX, and SerpApi sources** remain authoritative for external facts. Dynamic external facts must be rechecked against the official URL before repository changes.
- **Claude/Codex (optional fallback only):** not the active Nobu implementation workflow. If needed, use `prompts/CLAUDE_CODEX_LANE_PROMPT_TEMPLATE.md` under the same hard locks.
