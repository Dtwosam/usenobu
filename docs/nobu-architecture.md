# Nobu MVP Architecture

## Reference stack

The default implementation is:

- TypeScript;
- Next.js full-stack application or equivalent server-capable framework;
- PostgreSQL for deployed persistence;
- a provider scheduler/cron for bounded monitoring;
- server-side SerpApi client;
- optional email provider for alerts;
- public HTTPS deployment;
- free A2MCP-compatible JSON endpoint.

A different stack requires an ADR and must not weaken the contracts.

## AI agent boundary (Lane 7.5E / 7.5E.2)

- **Intake:** natural language → structured extraction (**Groq** or deterministic fallback) → confirmation UI.
- **Authority:** matching, policy, fingerprints, monitoring remain deterministic code paths.
- **API:** `POST /v1/agent` for bounded actions; `POST /v1/target-price-check` for structured Target checks.
- **Privacy:** raw purchase text is not stored in the DB; audits use hashes.
- **Provider:** Groq (`GROQ_API_KEY`, `https://api.groq.com/openai/v1`, default model `openai/gpt-oss-20b`).

## Platform concepts

Nobu is structured as a multi-retailer-capable platform with retailer-specific connectors:

- **Retailer** — merchant scope (only Target is live);
- **Retailer connector** — fetch/normalize price observations for one retailer;
- **Retailer policy** — eligibility and claim-route rules for one retailer;
- **Supported retailer** — retailer with an approved live integration;
- **Price observation** — third-party or authorized observed price with provenance;
- **Purchase monitor** — bounded monitoring loop over a locked product fingerprint.

Target-specific implementations remain named as Target-specific (Target policy engine, Target matching contract, Target policy data, `/v1/target-price-check`).

## Components

### 1. Web UI

- natural-language purchase intake + structured form (confirmation gate);
- candidate product confirmation;
- monitoring status;
- price history;
- price-drop alert;
- retailer claim instructions (Target for the live integration);
- privacy and supported-case notices.

### 1b. AI extract service (`src/ai/`)

- server-only **Groq** client (`groq-client.ts`) with strict JSON schema + Zod validation;
- fail-closed deterministic extractor when no key / invalid output / rate limit / auth failure;
- rate limiting, timeout, refusal handling;
- never invents identifiers; never starts matching or monitoring.

### 2. Purchase service

Stores:

- user/account reference;
- product URL (Target product URL for the live retailer);
- user-confirmed purchase price/date;
- purchase channel and jurisdiction;
- product fingerprint;
- monitoring deadline;
- status.

### 3. SerpApi connector

- creates normalized queries;
- fetches Google Shopping results;
- normalizes seller, identifiers, link, price, currency, location, timestamp;
- returns provider status without deciding policy eligibility.

### 4. Product matching engine

- candidate discovery;
- seller filter;
- exact identifier/model/variant comparison;
- user confirmation;
- locked fingerprint;
- fail-closed monitoring match.

### 5. Target policy engine

- 14-day calculation;
- supported channel/geography;
- known exclusions;
- current policy version;
- deterministic result status.

### 6. Monitoring scheduler

- selects active purchases inside the window;
- respects SerpApi capacity;
- checks each locked product;
- stores price observations;
- creates an alert only on a valid lower match;
- stops at expiry or unsupported state.

### 7. Notification service

MVP requires in-app alerts. Email is optional. Alerts must include provenance and never say refund guaranteed.

### 8. A2MCP API

The initial marketplace service performs a one-time Target purchase check and returns structured evidence. Persistent monitoring is available through the web product and may later become a paid ASP service.

## Core tables

- `users`
- `purchases`
- `product_matches`
- `price_observations`
- `monitor_runs`
- `alerts`
- `policy_versions`
- `api_call_audit`

## Scheduler capacity rule

The scheduler must calculate the remaining monthly search budget before selecting work. It must not overspend silently. Use a deterministic queue and record skipped checks with a reason.

## Observability

Record:

- provider latency/status;
- searches consumed;
- candidates returned;
- matching result;
- price observation;
- policy result;
- alert created or suppressed;
- endpoint status.

Do not log receipt images, full addresses, emails, keys, or sensitive personal data.
