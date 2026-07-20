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

## Lane 7.4A / 7.4A.1 — OKX agent-native paid monitoring research (repaired 2026-07-20)

**Source purity rule (7.4A.1):** for every claim about OKX.AI, A2MCP, Agentic Wallet, ASP registration, x402 payments, marketplace pricing, settlement networks/assets, review behavior, or listing topology, only official OKX/Onchain OS documentation or the coordinator-provided official findings below are authoritative. `x402.org`, Cloudflare's documentation, this environment's packaged Claude/Anthropic skills, WebSearch synthesis, the Solana `SettlementCache` detail, and generic MCP/x402 precedent were consulted in the original 7.4A pass and are **removed from the Lane 7.4 authority chain** as of this repair — none of them may be cited to support an OKX-specific claim anywhere in the 7.4 documents. This does not touch `TARGET-*` or `SERPAPI-*` rows above, which govern their own, unrelated contracts and are unaffected.

**Access note (2026-07-20, unchanged from 7.4A):** This lane's own research session could not reach `web3.okx.com` or `www.okx.com` (DNS resolution failed for both hosts from the sandboxed research environment) and received `HTTP 403` from `okx.ai` / `www.okx.ai` (reachable, bot-blocked). Wayback/archive mirrors are also blocked by tooling policy in this environment. This remains true in 7.4A.1 — this session still cannot fetch OKX domains directly. The four rows above (`OKX-HACKATHON`, `OKX-A2MCP`, `OKX-ASP`, `OKX-REGISTER`), last independently checked **2026-07-13** by a prior lane, **could not be re-verified this session**. They are carried forward as the best available record, marked `UNVERIFIED-THIS-SESSION` below.

| ID | Source | Publisher | URL | Relevant decision | Last checked | Status |
|---|---|---|---|---|---|---|
| OKX-HACKATHON | OKX.AI Genesis Hackathon | OKX | https://web3.okx.com/xlayer/build-x-series | Deadline, eligibility, categories, demo, listing requirement, judging | 2026-07-13 | **UNVERIFIED-THIS-SESSION** (blocked 2026-07-20, see access note) |
| OKX-A2MCP | A2MCP Guide | OKX | https://web3.okx.com/onchainos/dev-docs/okxai/howtomcp | Free HTTP 200 or x402, public HTTPS, X Layer payment configuration | 2026-07-13 | **UNVERIFIED-THIS-SESSION** (blocked 2026-07-20; superseded/extended by `OKX-A2MCP-2` below) |
| OKX-ASP | ASP Introduction | OKX | https://web3.okx.com/onchainos/dev-docs/okxai/asp-introduction | A2MCP suitability and review/listing flow | 2026-07-13 | **UNVERIFIED-THIS-SESSION** (blocked 2026-07-20) |
| OKX-REGISTER | ASP Registration | OKX | https://web3.okx.com/onchainos/dev-docs/okxai/registerasp | Registration prompts/fields and 24-hour wording | 2026-07-13 | **UNVERIFIED-THIS-SESSION** (blocked 2026-07-20; superseded/extended by `OKX-REGISTER-2` below) |
| OKX-ASP-TUTORIAL | Become an ASP | OKX | https://www.okx.ai/tutorial/asp | Free vs x402-paid endpoint requirement | not fetched — HTTP 403 both with/without `www.` | **BLOCKED** |

**Removed from the authority chain (7.4A.1 — kept here only as a historical record of what was consulted and why it no longer counts as evidence for OKX-specific facts):**

| Former ID | Source | Why removed |
|---|---|---|
| `OKX-PAY-SKILL` | `okx-agent-payments-protocol` packaged environment skill | Buyer/agent-side reference only, not OKX's own published documentation; not permitted as OKX-specific authority under the source purity rule. |
| `X402-FACILITATOR` | x402.org Facilitator docs | Generic x402 protocol, not an OKX source. |
| `X402-MCP-GUIDE` | x402.org MCP Server guide | Generic x402/MCP protocol, not an OKX source. |
| `CF-X402-MCP-TOOLS` | Cloudflare "Charge for MCP tools" | Cloudflare's own implementation, not an OKX source; the mixed-free/paid-endpoint inference drawn from it in the original 7.4A pass is withdrawn. |

None of the four remaining rows above nor any coordinator-provided fact below rests on any of the four removed sources.

### Coordinator-provided official OKX findings (2026-07-20)

**Provenance:** The rows below were **not fetched by this session** — `web3.okx.com` was DNS-blocked from this sandbox for the entire research window (see Access note above and the Blocked list below). These facts were supplied directly by the task coordinator, who had working access to the official pages, and are recorded here as coordinator-provided official-source evidence, distinct from this session's own (blocked) retrieval attempts.

| ID | Source | Publisher | URL | Relevant decision | Reported | Status |
|---|---|---|---|---|---|---|
| OKX-REGISTER-2 | ASP Registration | OKX | https://web3.okx.com/onchainos/dev-docs/okxai/registerasp | A2MCP registration takes a service name, description, a price per call, and one endpoint. Price `0` means a free service. | coordinator-provided 2026-07-20 | CONFIRMED (coordinator-sourced; not independently re-fetched by this session) |
| OKX-A2MCP-2 | A2MCP Guide | OKX | https://web3.okx.com/onchainos/dev-docs/okxai/howtomcp | The registered endpoint is documented as either: (1) free — returns the result directly; or (2) x402 pay-per-call — returns `HTTP 402` before payment and replay | coordinator-provided 2026-07-20 | CONFIRMED (coordinator-sourced; not independently re-fetched by this session) |
| OKX-PAY-HTTP | Payments — HTTP API | OKX | https://web3.okx.com/onchainos/dev-docs/payments/api-http | Seller-side payment flow: protected request → `HTTP 402` payment challenge → signed payment → request replay | coordinator-provided 2026-07-20 | CONFIRMED (coordinator-sourced; not independently re-fetched by this session) |
| OKX-PAY-PROXY | Payments — Seller Reverse Proxy | OKX | https://web3.okx.com/onchainos/dev-docs/payments/service-seller-reverseproxy | OKX reverse-proxy payment infrastructure can technically contain free and paid routes. This does not by itself prove that one OKX.AI A2MCP **listing** may mix free and paid request bodies — the reverse proxy is infrastructure, not confirmation of the marketplace listing rule. | coordinator-provided 2026-07-20 | CONFIRMED (coordinator-sourced; not independently re-fetched by this session) |
| OKX-XLAYER-EXAMPLE | X Layer payment example | OKX | (part of the OKX payments documentation set above) | Official worked example: network `eip155:196` (X Layer); asset **USD₮0**; asset address `0x779ded0c9e1022225f8e0630b35a9b54be713736`; decimals `6`; a `$0.99` display amount equals `990000` base units | coordinator-provided 2026-07-20 | CONFIRMED (coordinator-sourced; not independently re-fetched by this session) |

**What the coordinator-provided findings do and do not establish:**
- They establish that ASP registration takes one service name, description, one price per call, and one endpoint, and that price `0` means free.
- They establish the two documented endpoint forms (free-direct-200, or x402-402-then-replay) and the seller-side HTTP challenge/sign/replay shape.
- They establish a concrete, official X Layer settlement example (`eip155:196`, USD₮0 at `0x779ded0c9e1022225f8e0630b35a9b54be713736`, 6 decimals, `990000` base units for `$0.99`) — this resolves the previously-Unknown "exact settlement asset/token" question for a hypothetical X Layer USD₮0 charge, **if** X Layer USD₮0 is in fact the asset Nobu's own listing would use (not yet decided — no listing exists).
- They establish that OKX's reverse-proxy payment infrastructure *can* technically host both free and paid routes — but this is a statement about infrastructure capability, not about the A2MCP marketplace listing rule, and is **not** treated as proof that one A2MCP listing may mix free and paid actions.
- They do **not** establish whether a single registered A2MCP **listing** may mix free and paid actions (return `200` for some request bodies and `402` for others under one listing).
- They do **not** establish whether one provider (one Nobu identity) may register multiple differently priced A2MCP listings.
- They do **not** establish whether ASP `#5541` (currently free, `PENDING_REVIEW`) may change price while under review, or what resubmission consequence that would have.
- They do **not** establish whether OKX forwards a verified user/Agentic Wallet identity or email to the ASP.
- They do **not** establish whether OKX forwards any reusable cross-call authorization credential the ASP can rely on between requests.

### Findings summary — confirmed / unresolved / blocked

**Confirmed (OKX official sources only — coordinator-provided or previously independently checked and not superseded):**
- A2MCP registration: service name, description, price per call, one endpoint; price `0` = free.
- Endpoint is one of two documented forms: free-direct-200, or x402 pay-per-call (`402` → payment → replay).
- Seller-side flow: protected request → `402` challenge → signed payment → replay.
- Official X Layer settlement example: `eip155:196`, USD₮0, `0x779ded0c9e1022225f8e0630b35a9b54be713736`, 6 decimals, `990000` base units = `$0.99`.
- OKX's reverse-proxy infrastructure can technically carry both free and paid routes (infrastructure capability only — not a listing-model confirmation).

**Unresolved (kept open; not to be guessed or inferred from any non-OKX source):**
- Whether one A2MCP listing may mix free and paid actions.
- Whether Nobu may register multiple differently priced ASP listings.
- Whether ASP `#5541` may change price while under review.
- Whether OKX forwards verified user identity or email to the ASP.
- Whether OKX forwards a reusable cross-call authorization credential.

**Blocked (could not fetch at all this session):**
- `web3.okx.com/*` (DNS `ENOTFOUND`) — this is the host for `OKX-HACKATHON`, `OKX-A2MCP`, `OKX-ASP`, `OKX-REGISTER`, and all coordinator-provided pages (`registerasp`, `howtomcp`, `payments/api-http`, `payments/service-seller-reverseproxy`) — this session recorded the coordinator's findings from those pages but could not load them directly itself.
- `www.okx.com` (DNS `ENOTFOUND`).
- `www.okx.ai` / `okx.ai` (`HTTP 403`, both with and without `www.`).
- `web.archive.org` (blocked by tool policy, not attempted as a live fetch).

**Consequence for this lane's design — corrected 2026-07-20 (7.4A.1):**
- **Identity:** agent-native short-code email verification remains Nobu's selected, permanent identity architecture, independent of whether OKX ever forwards its own identity signal — the alert channel is Nobu's own liability surface regardless of source. This does not rest on any removed source.
- **Payment topology: not selected.** Per the coordinator-provided findings, an endpoint is one of two documented forms and OKX's reverse-proxy capability to host mixed routes does not prove a single A2MCP listing may do so. Three deployment possibilities are documented and none is selected (see the architecture document). Lane 7.4D opens with an **"OKX paid-service topology capability re-check"** to resolve the five Unresolved items above; if still unresolved, Lane 7.4D returns `NOBU_LANE_7_4D_BLOCKED`.
- **Source hierarchy:** only OKX official documentation and coordinator-provided OKX findings may determine OKX marketplace listing topology, ASP pricing behavior, identity propagation, supported marketplace assets/networks, or ASP review/resubmission rules. No other source — including the four removed above — may be cited for these questions anywhere in the Lane 7.4 documents.

## Change procedure

When an official source changes:

1. record the old and new fact;
2. cite the exact official URL and check date;
3. identify affected contracts, tests, listing copy, and demo;
4. update machine-readable policy/data files;
5. add or update tests;
6. do not silently patch behavior in code only.
