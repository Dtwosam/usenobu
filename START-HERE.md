# START-HERE — Nobu

**Product:** Nobu  
**Production:** https://usenobu.vercel.app  
**Date alignment:** 2026-07-20 (Lane 8R.2)

## What Nobu is

Nobu is an AI post-purchase monitoring agent that monitors the **exact product** after purchase and alerts the customer when a **safely matched lower price** may create an opportunity to **request the difference from the retailer**.

Customers use Nobu through:

1. the **UseNobu website**;
2. **OKX.AI** in compatible AI-agent environments.

**Target** is the only retailer currently supported. More retailers are planned; each requires a separate integration before support is claimed.

Nobu does **not** contact the retailer, submit a request, recover money, or guarantee a price adjustment. The customer contacts the retailer. The retailer verifies and decides.

Observed prices are third-party SerpApi Google Shopping observations, not an official Target API.

## Mandatory source stack

Read these in order before planning or changing code:

1. `AGENTS.md`
2. `docs/nobu-clean-master-spec.md`
3. `docs/nobu-current-state.md`
4. `docs/nobu-product-overview.md`
5. `docs/nobu-retailer-and-price-source-governance.md`
6. `docs/nobu-target-policy-contract.md`
7. `docs/nobu-serpapi-data-contract.md`
8. `docs/nobu-architecture.md`
9. `docs/nobu-okx-agent-native-paid-monitoring-architecture.md`
10. `openapi/nobu-a2mcp.openapi.yaml`
11. `openapi/nobu-agent-native-paid-monitoring-proposed.openapi.yaml` (implemented paid surface; ASP registration pending Lane 8R)
12. `docs/nobu-build-order.md`
13. `docs/nobu-test-and-proof-plan.md`
14. `docs/nobu-privacy-security-threat-model.md`
15. `docs/external-source-registry.md`

Historical-only (not active product positioning):

- `docs/nobu-hackathon-compliance-matrix.md` — **HISTORICAL ONLY**
- `docs/nobu-submission-runbook.md` — **HISTORICAL ONLY**

## Source precedence

1. Current official external rules, policies, terms, and API documentation  
2. `docs/nobu-clean-master-spec.md`  
3. `docs/nobu-current-state.md`  
4. Governance and policy contracts  
5. OpenAPI contracts  
6. Active build order  
7. Tests and proof plan  
8. README, prompts, and comments  

Dynamic external facts must be rechecked against the official URL before repository changes.

## Current architecture (summary)

- **Website** + **OKX.AI** dual access  
- Free `POST /v1/agent` (discovery, confirmation, email verification, preflight, monitor management)  
- Paid `POST /v1/agent/start-monitoring` — `$0.99` x402 v2 on X Layer USD₮0; official OKX verify/settle/status; durable activation saga  
- Separate free and paid A2MCP services under one ASP identity (**#5541** free listing live; paid service registration is **Lane 8R**)  
- Durable agent connection, email verification, consent, enrollment quotes  
- Exact-product confirmation and fail-closed matching  
- Durable scheduler bridge + consented email alerts  
- Shared web/agent monitoring pipeline  

## Active lane

See `docs/nobu-current-state.md`. Sequence: `8R.0 → 8R.1 → 8R.2 → 8R → 7.4G`.

Do not skip lanes. Do not edit or resubmit ASP `#5541` until Lane 8R.

## Proof expectations

- Lane-specific proof under `docs/proof/`  
- No secrets, payment signatures, raw emails, or settlement references in public proof  
- No fake live data, refunds, or approvals  
- Deploy only when the lane requires it  

## Implementation workflow

1. Confirm HEAD and active lane.  
2. Read the mandatory source stack.  
3. Short checklist; stop on first failure.  
4. Implement only that lane.  
5. Focused tests, then typecheck/build as required.  
6. Write proof; commit when asked; push/deploy only as the lane requires.  

Primary implementation agent: **Grok Build** (`prompts/GROK_BUILD_LANE_PROMPT_TEMPLATE.md`).

## Important product caveats

- Target makes the final price-adjustment decision.  
- Exact-product confirmation is required before monitoring.  
- Matching fails closed on ambiguity.  
- `$0.99` activates monitoring for one confirmed eligible purchase — it does not guarantee a lower price, alert, or adjustment.  
- Never collect Target passwords or retailer login.  
