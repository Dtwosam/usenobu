# Nobu

**Production:** [https://usenobu.vercel.app](https://usenobu.vercel.app)  
**Agent API:** `POST /v1/agent` (free) · `POST /v1/agent/start-monitoring` (paid activation)  
**Active lane:** see `docs/nobu-current-state.md`

## Product description

Nobu is an **AI post-purchase monitoring agent** that monitors the **exact product** after purchase and alerts the customer when a **safely matched lower price** may create an opportunity to **request the difference from the retailer**.

Customers often buy shortly before a price drop. Nobu keeps watch during the supported monitoring period so they can act in time. When a lower price is safely matched, Nobu shows a **possible price difference** and the retailer’s official contact path.

**Example:** purchase price `$79.99` → later safely matched price `$59.99` → **possible price difference `$20.00`**. Nobu alerts the customer. The customer may contact Target. **Target verifies the price, checks eligibility, and makes the final decision.**

## How customers use Nobu

1. **UseNobu website** — add purchases, confirm the exact product, inspect alerts, and use the Action Center.
2. **OKX.AI** — through compatible AI-agent environments: discover, confirm, verify email, activate monitoring, and manage monitors in conversation.

## Current retailer support

- **Target is the only retailer currently supported.**
- Eligible **Target.com** and **Target app** purchases (verified supported geography).
- **Target Plus** is excluded.
- More retailers are planned; each must be separately integrated, policy-verified, and data-source-validated before support is claimed.

Observed prices come from **SerpApi Google Shopping** (third-party observation, not an official Target API).

## What Nobu does not do

- Contact the retailer or submit a request
- Recover money or guarantee a lower price, alert, adjustment, or savings
- Access retailer accounts or collect Target passwords, cards, or 2FA

The **customer** contacts the retailer. The **retailer** verifies and decides.

## Start here

1. `START-HERE.md` — product entry, source stack, workflow  
2. `AGENTS.md` — hard locks and execution rules  
3. `docs/nobu-product-overview.md` — full product story  
4. `docs/nobu-faq.md` — short FAQ  
5. `docs/nobu-okx-user-guide.md` — OKX.AI customer guide  
6. Active lane only: `docs/nobu-current-state.md` + `docs/nobu-build-order.md`

Implementation agents: follow `AGENTS.md` and `prompts/GROK_BUILD_LANE_PROMPT_TEMPLATE.md`.

## Architecture and repository layout

| Path | Purpose |
|---|---|
| `app/` | Next.js website, free `/v1/agent`, paid `/v1/agent/start-monitoring` |
| `src/web/` | Purchase, monitoring UI services |
| `src/ai/` | Bounded agent actions and NL extraction |
| `src/matching/` | Fail-closed exact-product matching |
| `src/policy/` | Target policy engine |
| `src/serpapi/` | Third-party price observations |
| `src/payments/` | Official OKX seller verify / settle / status |
| `src/monitoring/` | Scheduled checks and durable bridge |
| `docs/` | Specs, contracts, build order, threat model |
| `openapi/` | Free and paid A2MCP OpenAPI contracts |

Canonical architecture: `docs/nobu-architecture.md` and `docs/nobu-okx-agent-native-paid-monitoring-architecture.md`.

## Local setup

```bash
cp .env.example .env   # never commit secrets
npm install
npm test
npm run typecheck
npm run dev
```

Production health: `GET https://usenobu.vercel.app/health`

## Active lane

See **`docs/nobu-current-state.md`**. Full sequence: **`docs/nobu-build-order.md`**.

Adopted sequence: `8R.0 → 8R.1 → 8R.2 → 8R → 7.4G`.

## Privacy and secrets

- No secrets in git; use environment variables only.
- No retailer login, card, bank, ID, wallet-key, password, or 2FA collection.
- Email for sign-in and consented alerts is private and must not appear in public proof.
