# AfterBuy

**Status:** Lane 1 complete / domain schemas and deterministic contracts  
**Hackathon:** OKX.AI Genesis Hackathon  
**MVP retailer:** Target.com (U.S., excluding Alaska and Hawaii)  
**Price source:** SerpApi Google Shopping (third-party observation, not an official Target API)  
**Primary implementation agent:** Grok Build

AfterBuy lets a user add a recent eligible Target.com purchase once. It checks a third-party shopping data source for a lower Target online price during Target's 14-day adjustment window and alerts the user when they may be able to request the difference.

AfterBuy does **not** guarantee a refund, submit a claim, log into Target, scrape Target, or claim observed prices are official Target API prices. Target verifies the price and makes the final decision.

## Start here

1. Read `START-HERE.md` and `AGENTS.md`.
2. Follow the mandatory source stack in those files.
3. Build only against the active lane in `docs/afterbuy-build-order.md`.
4. Implement with **Grok Build** using `prompts/GROK_BUILD_LANE_PROMPT_TEMPLATE.md`.

## Tool workflow

| Tool | Role |
|---|---|
| **ChatGPT** | Product, architecture, lane coordination, source-of-truth management, and review |
| **Grok Build** | Primary repository implementation and test execution, lane by lane |
| **Regular Grok research** | Public discussion, competition, and external-change research only (`prompts/GROK_RESEARCH_VERIFICATION_PROMPT.md`) |
| **Official Target / OKX / SerpApi sources** | Authoritative for external facts |
| **Claude/Codex** | Optional fallback only (`prompts/CLAUDE_CODEX_LANE_PROMPT_TEMPLATE.md`); not the active workflow |

Regular Grok research does not implement product code and does not override official sources.

## Source precedence

When sources conflict:

1. Current official external rules, policies, terms, and API documentation
2. `docs/afterbuy-clean-master-spec.md`
3. `docs/afterbuy-current-state.md`
4. Compliance and governance documents
5. Policy/data contracts and `openapi/afterbuy-a2mcp.openapi.yaml`
6. Active build order
7. Tests and proof plan
8. README, prompts, demo copy, and comments

## Hard product locks (MVP)

- Target only; Target Plus excluded
- Target.com / Target online purchase channel only
- U.S. geography excluding Alaska and Hawaii unless later verified otherwise
- Exact product confirmation before monitoring; fail-closed matching
- Free A2MCP endpoint first; x402 only after free service is stable and listed
- No secrets in the repository; use environment variables only

## Repository layout

| Path | Purpose |
|---|---|
| `AGENTS.md` | Agent execution rules and product locks |
| `START-HERE.md` | Source-of-truth entry point |
| `docs/` | Specs, contracts, build order, ADRs, threat model |
| `data/retailer-policies/` | Machine-readable Target policy fixtures |
| `openapi/` | Free A2MCP OpenAPI contract |
| `prompts/` | Grok Build lane template, research prompt, optional fallbacks |

## Local environment

Copy `.env.example` to `.env` and fill in values locally. Never commit `.env` or real API keys.

```bash
cp .env.example .env
npm install
npm test
npm run typecheck
```

Lane 1 domain contracts live under `src/domain/`. Database models and SQL migrations live under `src/db/`. Local migration proof uses Node built-in `node:sqlite` (no secrets, no native compile). Production remains PostgreSQL per the architecture doc.

## Reference stack

Default implementation (see `docs/afterbuy-architecture.md`):

- TypeScript
- Next.js (or equivalent server-capable framework)
- PostgreSQL for deployed persistence
- Server-side SerpApi client
- Public HTTPS deployment
- Free A2MCP-compatible JSON endpoint

A different stack requires an ADR and must not weaken the contracts.

## Active build lane

See `docs/afterbuy-current-state.md` for the current lane and `docs/afterbuy-build-order.md` for the full sequence. Do not skip lanes or invent live proof.

**Current active lane after Lane 1 closeout:** Lane 2 — Target policy engine.

## License / secrets

Do not commit API keys, credentials, wallet keys, passwords, or personal data. See `docs/afterbuy-privacy-security-threat-model.md`.
