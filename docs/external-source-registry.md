# External Source Registry

**Rule:** Official sources govern policy and hackathon facts. SerpApi official documentation governs its API, pricing, and terms. Public discussion can inform product positioning but cannot override these sources.

| ID | Source | Publisher | URL | Relevant decision | Last checked | Status |
|---|---|---|---|---|---|---|
| OKX-HACKATHON | OKX.AI Genesis Hackathon | OKX | https://web3.okx.com/xlayer/build-x-series | Deadline, eligibility, categories, demo, listing requirement, judging | 2026-07-13 | CURRENT |
| OKX-A2MCP | A2MCP Guide | OKX | https://web3.okx.com/onchainos/dev-docs/okxai/howtomcp | Free HTTP 200 or x402, public HTTPS, X Layer payment configuration | 2026-07-13 | CURRENT |
| OKX-ASP | ASP Introduction | OKX | https://web3.okx.com/onchainos/dev-docs/okxai/asp-introduction | A2MCP suitability and review/listing flow | 2026-07-13 | CURRENT |
| OKX-REGISTER | ASP Registration | OKX | https://web3.okx.com/onchainos/dev-docs/okxai/registerasp | Registration prompts/fields and 24-hour wording | 2026-07-13 | CURRENT |
| TARGET-POLICY | Price Match Guarantee | Target | https://www.target.com/help/articles/policies-guidelines/price-match-guarantee | 14-day window, identical item, proof, exclusions, Alaska/Hawaii, Target Plus; Target decides | 2026-07-15 | CURRENT |
| TARGET-SUMMARY | Target price-match summary | Target | https://www.target.com/help/article/000062256 | Contact routes and summary | 2026-07-15 | CURRENT |
| TARGET-CONTACT | Contact Us | Target | https://www.target.com/help/contact-us | Official help/contact entry for Guest Services / chat (production request route for Action Center). Not a blog. | 2026-07-15 | CURRENT |
| SERPAPI-PRICING | Plans and Pricing | SerpApi | https://serpapi.com/pricing | Free plan 250 searches/month | 2026-07-13 | CURRENT |
| SERPAPI-SHOPPING | Google Shopping API | SerpApi | https://serpapi.com/google-shopping-api | Engine, endpoint, parameters, structured shopping results | 2026-07-13 | CURRENT |
| SERPAPI-LEGAL | Legal Documents | SerpApi | https://serpapi.com/legal | Terms and Legal Shield limits | 2026-07-13 | CURRENT |
| SERPAPI-PRICE-MONITOR | Price Monitoring use case | SerpApi | https://serpapi.com/use-cases/price-monitoring | Provider explicitly supports price-monitoring use cases | 2026-07-13 | CURRENT |
| OPENAI-PROJECTS | Projects in ChatGPT | OpenAI | https://help.openai.com/en/articles/10169521-projects-in-chatgpt | Upload project sources and add project instructions | 2026-07-13 | CURRENT |

## Lane 7.4A — OKX agent-native paid monitoring research

**Access note (2026-07-20):** This lane's research session could not reach `web3.okx.com` or `www.okx.com` (DNS resolution failed for both hosts from the sandboxed research environment) and received `HTTP 403` from `okx.ai` / `www.okx.ai` (reachable, bot-blocked). Wayback/archive mirrors are also blocked by tooling policy in this environment. The four rows above (`OKX-HACKATHON`, `OKX-A2MCP`, `OKX-ASP`, `OKX-REGISTER`), last independently checked **2026-07-13** by a prior lane, **could not be re-verified this session**. They are carried forward as the best available record but are marked `UNVERIFIED-THIS-SESSION` below pending a session with OKX-domain access. No fact in this lane's architecture doc is attributed to a URL this session could not actually load.

| ID | Source | Publisher | URL | Relevant decision | Last checked | Status |
|---|---|---|---|---|---|---|
| OKX-HACKATHON | OKX.AI Genesis Hackathon | OKX | https://web3.okx.com/xlayer/build-x-series | Deadline, eligibility, categories, demo, listing requirement, judging | 2026-07-13 | **UNVERIFIED-THIS-SESSION** (blocked 2026-07-20, see access note) |
| OKX-A2MCP | A2MCP Guide | OKX | https://web3.okx.com/onchainos/dev-docs/okxai/howtomcp | Free HTTP 200 or x402, public HTTPS, X Layer payment configuration | 2026-07-13 | **UNVERIFIED-THIS-SESSION** (blocked 2026-07-20; X Layer / chain 196 detail cross-corroborated below, see OKX-PAY-SKILL) |
| OKX-ASP | ASP Introduction | OKX | https://web3.okx.com/onchainos/dev-docs/okxai/asp-introduction | A2MCP suitability and review/listing flow | 2026-07-13 | **UNVERIFIED-THIS-SESSION** (blocked 2026-07-20) |
| OKX-REGISTER | ASP Registration | OKX | https://web3.okx.com/onchainos/dev-docs/okxai/registerasp | Registration prompts/fields and 24-hour wording | 2026-07-13 | **UNVERIFIED-THIS-SESSION** (blocked 2026-07-20) |
| OKX-ASP-TUTORIAL | Become an ASP | OKX | https://www.okx.ai/tutorial/asp | Free vs x402-paid endpoint requirement | not fetched — HTTP 403 both with/without `www.` | **BLOCKED** |
| OKX-PAY-SKILL | `okx-agent-payments-protocol` packaged skill (this Claude Code environment) | Anthropic/OKX-maintained environment skill, not a public URL | n/a — local skill package `C:\Users\dtwof\.claude\skills\okx-agent-payments-protocol` | Buyer/agent-side x402 mechanics: `PAYMENT-REQUIRED`/`X-PAYMENT`/`PAYMENT-SIGNATURE` headers, `WWW-Authenticate: Payment` with `intent=charge\|session`, schemes `exact`/`aggr_deferred`/`upto`/`period`, a2a-pay `paymentId` flow, example EVM `chainId: 196` labelled "X Layer", CLI `onchainos payment ...`, wallet login via email OTP or AK | loaded 2026-07-20 | CONFIRMED (for buyer-side mechanics only; does not document ASP/seller-side implementation contract) |
| X402-FACILITATOR | Facilitator (verify/settle) | x402.org | https://docs.x402.org/core-concepts/facilitator | Generic x402 verify/settle flow, Solana replay-cache mitigation (120s dedupe), 402 re-issued on verification failure | 2026-07-20 | CONFIRMED (generic x402 protocol; not OKX-specific — OKX's facilitator behavior is not independently confirmed) |
| X402-MCP-GUIDE | MCP Server with x402 | x402.org | https://docs.x402.org/guides/mcp-server-with-x402 | Generic 402 flow (`PAYMENT-REQUIRED` → sign → retry with `PAYMENT-SIGNATURE` → 200); single-tool example does not show per-tool free/paid mixing | 2026-07-20 | CONFIRMED (generic x402; silent on multi-action pricing) |
| CF-X402-MCP-TOOLS | Charge for MCP tools | Cloudflare | https://developers.cloudflare.com/agents/agentic-payments/x402/charge-for-mcp-tools/ | Documented pattern: one MCP server mixes free tools (`server.tool()`) and paid tools (`server.paidTool(name, desc, priceUsd, ...)`) on the same endpoint; 402 triggers per-tool-call only; each paid tool has its own independent USD price | 2026-07-20 | CONFIRMED (Cloudflare's own implementation of x402 for MCP, generic precedent only — see coordinator findings below for the OKX-specific answer) |

### Coordinator-provided official OKX findings (2026-07-20)

**Provenance:** The four rows below were **not fetched by this session** — `web3.okx.com` was DNS-blocked from this sandbox for the entire research window (see Access note above and the Blocked list below). These facts were supplied directly by the task coordinator, who had working access to the official pages, and are recorded here as coordinator-provided official-source evidence, distinct from this session's own (blocked) retrieval attempts. They supersede this session's earlier `CF-X402-MCP-TOOLS`-based inference about mixed free/paid endpoints, which was a generic-precedent guess, not an OKX-specific finding.

| ID | Source | Publisher | URL | Relevant decision | Reported | Status |
|---|---|---|---|---|---|---|
| OKX-REGISTER-2 | ASP Registration | OKX | https://web3.okx.com/onchainos/dev-docs/okxai/registerasp | A2MCP registration requires service name, description, a **fixed price per call**, and one endpoint | coordinator-provided 2026-07-20 | CONFIRMED (coordinator-sourced; not independently re-fetched by this session) |
| OKX-A2MCP-2 | A2MCP Guide | OKX | https://web3.okx.com/onchainos/dev-docs/okxai/howtomcp | Registered endpoint must be one of exactly two compliant forms: (1) free — returns the result directly with `HTTP 200`; or (2) x402 pay-per-call — returns `HTTP 402`, followed by payment and request replay | coordinator-provided 2026-07-20 | CONFIRMED (coordinator-sourced; not independently re-fetched by this session) |
| OKX-PAY-HTTP | Payments — HTTP API | OKX | https://web3.okx.com/onchainos/dev-docs/payments/api-http | Seller-side HTTP flow: protected resource → payment challenge → signed payment → request replay | coordinator-provided 2026-07-20 | CONFIRMED (coordinator-sourced; not independently re-fetched by this session) |
| OKX-PAY-PROXY | Payments — Seller Reverse Proxy | OKX | https://web3.okx.com/onchainos/dev-docs/payments/service-seller-reverseproxy | Seller-side reverse-proxy pattern for gating a protected resource behind x402 | coordinator-provided 2026-07-20 | CONFIRMED (coordinator-sourced; not independently re-fetched by this session) |

**What the coordinator-provided findings do and do not establish:**
- They establish that ASP registration is **one fixed price per call, per endpoint** — not a per-action price list — and that an endpoint is binary: free-200 or x402-paid, not both.
- They do **not** establish whether a single registered endpoint may mix free and paid actions (i.e., return `200` for some request bodies and `402` for others at the same URL). The two-compliant-forms description reads as endpoint-level, not per-request, but the coordinator's source pages do not explicitly confirm or rule out per-request branching inside one compliant endpoint.
- They do **not** establish whether one provider (one Nobu identity) may register multiple A2MCP listings/endpoints at different prices.
- They do **not** establish whether ASP `#5541` (currently free, `PENDING_REVIEW`) can safely change from free to paid while under review, or what resubmission consequence that would have.

### Findings summary — confirmed / inferred / unknown / blocked

**Confirmed (directly fetched, official-source or officially-packaged this session):**
- Generic x402 protocol shape: `402` + `PAYMENT-REQUIRED` header (base64 JSON, v2) or body `x402Version` (v1) → client signs → retries with `PAYMENT-SIGNATURE` (or `X-PAYMENT` for legacy v1) → `200`. (X402-MCP-GUIDE, OKX-PAY-SKILL)
- OKX's own Agent Payments Protocol byte-for-byte reuses this same header/field vocabulary (`x402Version`, `X-PAYMENT`, `PAYMENT-SIGNATURE`, `PAYMENT-REQUIRED`, `WWW-Authenticate: Payment`) plus OKX-specific extensions: `intent=charge` (one-shot, optional split payees) vs `intent=session` (channel + vouchers, `channelId`), and a non-402 `a2a-pay` `paymentId`-link flow. (OKX-PAY-SKILL)
- A concrete OKX EVM chain id `196` is labelled "X Layer" in the packaged skill's own worked example, corroborating the pre-existing (2026-07-13) `OKX-A2MCP` registry note "X Layer payment configuration" even though that page could not be re-fetched this session. Treated as CONFIRMED by cross-corroboration.
- Mixing free and paid actions on one server endpoint, with independent per-action pricing and per-call 402 triggering, is a documented, standard x402/MCP pattern (Cloudflare `paidTool`). Not OKX-specific, but no OKX source found or fetchable that contradicts it, and OKX's ASP model (one HTTP endpoint per ASP, per existing `OKX-A2MCP` note and Nobu's own live `#5541` registration) is structurally compatible with it.
- Solana-side x402 has a known duplicate-settlement race (pre-confirmation replay) mitigated by a 120-second `SettlementCache`; EVM-side settlement is not affected the same way. Relevant if OKX ever settles on an SVM network; X Layer is EVM, so this specific race is likely not applicable, but exact-once monitor creation must not rely on the payment layer alone regardless (see architecture doc idempotency design).

**Inferred (from WebSearch synthesis only — NOT independently fetched/quoted this session, treat as directional, not authoritative):**
- OKX ASP paid actions "need an x402-compliant endpoint"; free actions "simply return the result directly" — consistent with, but not proof of, the mixed-endpoint pattern above.
- "Synchronous settlement" is named as one settlement mode ("server waits for on-chain confirmation before returning the resource... best suited for one-off, low-frequency payments") which matches Nobu's one-time $0.99 activation use case, but the full settlement-mode list (is there an async/deferred mode too?) is not confirmed.

**Unknown / requires live verification before Lane 7.4D implementation (not resolved by this lane; documentation-only):**
- Whether one registered A2MCP endpoint may branch per-request between a free `200` result and an x402 `402` challenge (mixed free/paid actions under one URL), or whether OKX's "one of two compliant forms" rule is enforced at the endpoint level, forcing a genuinely separate paid endpoint/listing.
- Whether one provider may register multiple A2MCP listings/endpoints at different prices (a second paid ASP identity, or a second endpoint under the same ASP identity).
- Whether ASP `#5541` can change from free to paid while `PENDING_REVIEW`, and what resubmission that requires.
- Exact settlement asset/token for a $0.99 charge on X Layer (chain 196) — likely a stablecoin, not confirmed.
- Whether OKX passes any stable, verifiable end-user or Agentic Wallet identity (address, verified email, or signed identity assertion) to the ASP's HTTP request. No source found or fetchable that confirms this. The packaged skill's "log in via email OTP or AK" reference is about the **wallet's own login**, not about identity forwarded to third-party ASP servers.
- Whether A2MCP requests carry any session/authorization mechanism the ASP can rely on across multiple calls (vs. the ASP having to round-trip its own opaque state in the JSON body/response, as Nobu's existing `AgentRequest` schema already does for `purchase_id`).

**Blocked (could not fetch at all this session):**
- `web3.okx.com/*` (DNS `ENOTFOUND`) — this is the host for `OKX-HACKATHON`, `OKX-A2MCP`, `OKX-ASP`, `OKX-REGISTER`, the Agentic Wallet/x402-introduction pages, and the four coordinator-provided pages above (`registerasp`, `howtomcp`, `payments/api-http`, `payments/service-seller-reverseproxy`) — this session recorded the coordinator's findings from those pages but could not load them directly itself.
- `www.okx.com` (DNS `ENOTFOUND`).
- `www.okx.ai` / `okx.ai` (`HTTP 403`, both with and without `www.`).
- `web.archive.org` (blocked by tool policy, not attempted as a live fetch).

**Consequence for this lane's design — corrected 2026-07-20:**
- **Identity:** the agent-native short-code email-verification fallback is adopted as Nobu's selected default architecture, not as a stopgap pending better OKX identity proof. Nobu needs to independently verify the destination that receives private purchase/price-drop alerts regardless of what any future OKX identity signal supplies, because the alert channel is Nobu's own liability surface. No source, coordinator-provided or otherwise, changes this.
- **Payment topology: not selected in this lane.** The coordinator-provided findings confirm registration is one fixed price per call per endpoint and that an endpoint is binary (free-200 or x402-paid), which rules out treating "mixed free/paid under one endpoint, no listing change" as a safe default — that path is not proven and is not adopted. Lane 7.4A instead documents two deployment alternatives (Option A: separate free orchestration ASP + separate paid `$0.99` activation ASP; Option B: one paid activation ASP, with free preparation happening client-side/web) behind an explicit capability gate. Neither is selected. Lane 7.4D opens with **"OKX paid-service topology capability re-check"** to resolve: per-request free/paid branching under one endpoint; multi-listing/multi-price support; and whether `#5541` may safely become paid while under review. If unresolved at that point, Lane 7.4D returns `NOBU_LANE_7_4D_BLOCKED` rather than guessing.
- **Source hierarchy:** generic x402.org and Cloudflare documentation (`X402-FACILITATOR`, `X402-MCP-GUIDE`, `CF-X402-MCP-TOOLS`) corroborate protocol-level HTTP mechanics only (challenge/sign/replay shape, settlement/idempotency behavior at the transport layer). They do not and cannot determine OKX marketplace listing topology, ASP pricing behavior, identity propagation, supported marketplace assets, or ASP review/resubmission rules — those are governed exclusively by OKX's own documentation (coordinator-provided rows above) and, where still open, remain `Unknown` until Lane 7.4D's capability re-check.

## Change procedure

When an official source changes:

1. record the old and new fact;
2. cite the exact official URL and check date;
3. identify affected contracts, tests, listing copy, and demo;
4. update machine-readable policy/data files;
5. add or update tests;
6. do not silently patch behavior in code only.
