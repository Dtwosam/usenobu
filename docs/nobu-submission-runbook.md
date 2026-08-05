# Nobu Submission Runbook

> **HISTORICAL ONLY (Lane 8R.2).** Retained for audit history of the original listing/registration process. Not active product positioning. For current ASP update work, follow **Lane 8R** in `docs/nobu-build-order.md` and live product docs (`docs/nobu-product-overview.md`, OpenAPI contracts).

## Listing identity

**Name:** Nobu
**Type:** A2MCP
**Initial price:** 0
**Primary category:** Lifestyle Companion
**Secondary positioning:** Software Utility

## Accurate listing description

> Nobu is an AI agent that monitors supported purchases after checkout and alerts users when a lower retailer price may be available. It understands natural-language purchase details, requires user confirmation, then applies deterministic Target policy and exact-product matching. The live integration supports eligible Target.com purchases only. Free endpoint: https://www.usenobu.xyz/v1/agent. Target verifies the lower price and makes the final decision.

## Preferred listing URL

`https://www.usenobu.xyz/v1/agent`

Do not claim:

- official Target API integration;
- all Target products or locations;
- automatic refunds;
- guaranteed eligibility;
- that other retailers are already live or available;
- claim submission.

## Endpoint preflight

- public HTTPS;
- free endpoint returns HTTP 200;
- valid JSON;
- documented input/output;
- health check passes;
- rate limits active;
- provider errors handled;
- no secrets in response or logs.

## Current official registration workflow

1. Install Onchain OS and log in to Agentic Wallet using the current official guide.
2. Register as an A2MCP ASP.
3. Provide service name, description, price `0`, and endpoint.
4. Ask Onchain OS to list the ASP.
5. Monitor the registered email/Agent notification for review result.
6. Fix and resubmit if rejected.
7. Do not call the hackathon submission valid until the ASP is live.

Do not bypass any platform account or eligibility requirement.

## X post checklist

- `#OKXAI` included;
- Nobu introduced in one sentence;
- real user problem explained;
- demo/walkthrough no longer than 90 seconds;
- price source honestly labelled;
- no guaranteed refund claim;
- live ASP route shown;
- supported case and limitation clear.

## Demo story

1. User adds a recent Target.com purchase.
2. Nobu identifies a Target offer and the user confirms the exact product.
3. Monitoring runs.
4. A lower observed Target price appears.
5. Nobu shows potential recovery and days remaining.
6. Nobu shows Target's official contact route and explains Target verifies the price.

If a natural live price drop is unavailable, use a clearly labelled recorded historical observation or test fixture for the transition while still showing a real live provider lookup. Never present a fixture as a real current refund opportunity.

## Final form checklist

- ASP details;
- live listing proof;
- X post link;
- submitted before 2026-07-17 23:59 UTC;
- confirmation archived.
