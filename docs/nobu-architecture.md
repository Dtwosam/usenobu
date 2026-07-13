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

## Components

### 1. Web UI

- add purchase form;
- candidate product confirmation;
- monitoring status;
- price history;
- price-drop alert;
- Target claim instructions;
- privacy and supported-case notices.

### 2. Purchase service

Stores:

- user/account reference;
- Target product URL;
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
