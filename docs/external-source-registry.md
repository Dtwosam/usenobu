# External Source Registry

**Rule:** Official sources govern **policy and technical product facts**. SerpApi official documentation governs its API, pricing, and terms. Public discussion can inform product positioning but cannot override these sources. **Current product decisions do not depend on competition rules.**

## Active authority (product engineering)

| ID | Source | Publisher | URL | Relevant decision | Last checked | Status |
|---|---|---|---|---|---|---|
| OKX-A2MCP | A2MCP Guide | OKX | https://web3.okx.com/onchainos/dev-docs/okxai/howtomcp | Free HTTP 200 or x402, public HTTPS, X Layer payment configuration | 2026-07-13 | CURRENT (active technical) |
| OKX-ASP | ASP Introduction | OKX | https://web3.okx.com/onchainos/dev-docs/okxai/asp-introduction | A2MCP suitability and review/listing flow | 2026-07-13 | CURRENT (active technical) |
| OKX-REGISTER | ASP Registration | OKX | https://web3.okx.com/onchainos/dev-docs/okxai/registerasp | Registration prompts/fields and 24-hour wording | 2026-07-13 | CURRENT (active technical) |
| TARGET-POLICY | Price Match Guarantee | Target | https://www.target.com/help/articles/policies-guidelines/price-match-guarantee | 14-day window, identical item, proof, exclusions, Alaska/Hawaii, Target Plus; Target decides | 2026-07-15 | CURRENT |
| TARGET-SUMMARY | Target price-match summary | Target | https://www.target.com/help/article/000062256 | Contact routes and summary | 2026-07-15 | CURRENT |
| TARGET-CONTACT | Contact Us | Target | https://www.target.com/help/contact-us | Official help/contact entry for Guest Services / chat (production request route for Action Center). Not a blog. | 2026-07-15 | CURRENT |
| SERPAPI-PRICING | Plans and Pricing | SerpApi | https://serpapi.com/pricing | Free plan 250 searches/month | 2026-07-13 | CURRENT |
| SERPAPI-SHOPPING | Google Shopping API | SerpApi | https://serpapi.com/google-shopping-api | Engine, endpoint, parameters, structured shopping results | 2026-07-13 | CURRENT |
| SERPAPI-LEGAL | Legal Documents | SerpApi | https://serpapi.com/legal | Terms and Legal Shield limits | 2026-07-13 | CURRENT |
| SERPAPI-PRICE-MONITOR | Price Monitoring use case | SerpApi | https://serpapi.com/use-cases/price-monitoring | Provider explicitly supports price-monitoring use cases | 2026-07-13 | CURRENT |
| OPENAI-PROJECTS | Projects in ChatGPT | OpenAI | https://help.openai.com/en/articles/10169521-projects-in-chatgpt | Upload project sources and add project instructions | 2026-07-13 | CURRENT |

## Historical-only (not active product authority)

| ID | Source | Publisher | URL | Relevant decision | Last checked | Status |
|---|---|---|---|---|---|---|
| OKX-HACKATHON | OKX.AI Genesis Hackathon | OKX | https://web3.okx.com/xlayer/build-x-series | Historical deadline, eligibility, categories, demo, listing requirement | 2026-07-13 | **HISTORICAL ONLY** — not active product authority (Lane 8R.2) |

Competition-related material may remain in historical proof folders. Do not use it to decide current product behavior.

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

## Lane 7.4D.0 — Official OKX paid-service topology re-check (2026-07-20)

**Access note (2026-07-20):** `web3.okx.com` and `www.okx.com` remained DNS-unreachable (`ENOTFOUND`) from this session — the direct-fetch block from Lane 7.4A/7.4A.1 persists unchanged. However, `github.com/okx/onchainos-skills` (the official OKX/Onchain OS skills repository named in this lane's source rule) **was reachable this session** and was fetched directly. Additionally, the official Onchain OS CLI (`onchainos.exe`, version `4.2.4`, installed at `%USERPROFILE%\.onchainos\bin\`, matching a `checksums.txt` multi-platform release manifest) was already installed in this environment from prior lane work. Its `--help` schemas were inspected **read-only** — no `agent create`, `agent update`, `agent activate`, or any other state-changing command was executed. This directly satisfies the lane's source rule: official OKX/Onchain OS documentation, the official `okx/onchainos-skills` repository, and read-only help/schema output from installed official tooling.

| ID | Source | Publisher | URL / Command | Relevant decision | Checked | Status |
|---|---|---|---|---|---|---|
| OKX-CLI-HELP | `onchainos` CLI help schema | OKX (Onchain OS, official installed binary) | `onchainos.exe agent --help`, `agent create --help`, `agent update --help`, `agent activate --help`, `agent service-list --help`, `payment pay --help`, `payment charge --help`, `payment default --help` (v4.2.4) | Multi-service-per-agent schema; update-vs-create semantics; x402 v2 header names; fee currency/decimals | 2026-07-20 | CONFIRMED (this session, self-run, read-only) |
| OKX-SKILLS-IDENTITY-REGISTER | `okx-ai` skill — identity-register.md | OKX | `github.com/okx/onchainos-skills` → `skills/okx-ai/references/identity-register.md` | Service array structure; "multiple services per agent are fully supported"; per-service `fee`/`endpoint` fields | 2026-07-20 | CONFIRMED (this session, self-fetched) |
| OKX-SKILLS-IDENTITY-UPDATE | `okx-ai` skill — identity-update.md | OKX | `github.com/okx/onchainos-skills` → `skills/okx-ai/references/identity-update.md` | Update never creates a new agent id; QA re-runs on update when a QA-governed field (name/description/service create-or-update) changes; documented fix path for a rejected listing is `agent update` on the same id | 2026-07-20 | CONFIRMED (this session, self-fetched) |
| OKX-SKILLS-IDENTITY-INVARIANTS | `okx-ai` skill — identity-invariants.md | OKX | `github.com/okx/onchainos-skills` → `skills/okx-ai/references/identity-invariants.md` | No documented hard limit on service count; role immutable after creation; no explicit endpoint-sharing constraint across services | 2026-07-20 | CONFIRMED (this session, self-fetched) |
| OKX-SKILLS-PAYMENTS | `okx-agent-payments-protocol` skill — SKILL.md + `_shared/amount-display.md` | OKX | `github.com/okx/onchainos-skills` → `skills/okx-agent-payments-protocol/` | x402 v2 header shapes (`PAYMENT-REQUIRED`/`WWW-Authenticate` → `PAYMENT-SIGNATURE`); `chainId: 196` = X Layer (worked decode example); settlement decimals table (USDC/USDT/USDG all 6 decimals, `human = atomic / 10^decimals`) | 2026-07-20 | CONFIRMED (this session, self-fetched) |

**New facts established this session (official CLI schema + official skills repo, cross-corroborating each other):**

1. **One agent may register multiple A2MCP services, each with an independent `fee` and `endpoint`.** `agent create --help`: `--service` is "Service list as a JSON array" with per-element `serviceType`/`fee`/`endpoint`. `identity-register.md`: *"All services ship in one `agent create`" — multiple services per agent are fully supported.* This is a general Agent-identity capability (not A2MCP-specific plumbing) but applies directly since `serviceType: "A2MCP"` can appear more than once in the array.
2. **`agent update` never creates a new agent id.** `agent update --help` (`--agent-id` required, no `--role`) plus `identity-update.md`: *"Rejected listing → update the same agent, never create new."* Corroborated empirically by this project's own Lane 8 avatar-fix evidence (`docs/proof/okx/gate5-update-avatar-redacted.json`: `{"newAgentId":null,...}`).
3. **Editing an agent (service create/update, name, or description) re-triggers QA review.** `identity-update.md`: QA "runs as a single batch pass... when role is `asp` AND a QA-governed field changed (agent name, description, or any service create/update entry)." Matches `agent activate --help`'s own note: "QA runs at register/update, not here [activate]." Empirically corroborated: the Lane 8 avatar update required a fresh `activate` call, which returned `approvalStatus: 2` (under review) again.
4. **Services update incrementally — omitted services are preserved.** `agent update --help`: "Optional. Incremental service changes as a JSON array — only the services you want to add / modify / remove, NOT the full list... Omitted → the `services` field is left out entirely (omission does NOT clear existing services)." This means an existing free A2MCP service can be left untouched while a new paid A2MCP service is added via one `operation: "create"` entry.
5. **x402 v2 mechanics, confirmed via the official CLI itself (not a third-party spec):** `payment pay` decodes the raw `PAYMENT-REQUIRED` header value (base64 `{x402Version, resource, accepts}`) and returns an `authorization_header`/`PAYMENT-SIGNATURE`; `payment charge` decodes a `WWW-Authenticate` challenge with `methodDetails` (`feePayer`, `splits[]`). `agent create --help` / `agent update --help`: A2MCP `fee` is "a plain number, USDT implied, ≤6 decimals." The official skill's own settlement decimals table lists USDC/USDT/USDG all at 6 decimals with `human = atomic / 10^decimals` (a $0.99 charge = `990000` atomic units) — independently corroborating the shape (asset family, decimal precision, and unit conversion) of the previously coordinator-provided `OKX-XLAYER-EXAMPLE` fact.
6. **X Layer chain id 196 (`eip155:196`) confirmed from a second, independent official source** — the `okx-agent-payments-protocol` skill's own worked `WWW-Authenticate` decode example uses `chainId: 196` labelled "X Layer," matching the coordinator-provided `eip155:196`.

**Still not established by any official source reached or supplied (genuine gaps, not to be guessed):**
- The exact settlement asset for a Nobu-specific charge is not independently confirmed by this session's fetches — the general shared decimals table lists USDC/USDT/USDG (no literal "USD₮0" row); this file directs unlisted tokens to a live `okx-dex-market` decimal lookup rather than a static table. The specific `USD₮0` at `0x779ded0c9e1022225f8e0630b35a9b54be713736` remains **coordinator-provided only**, now generically (not literally) corroborated by the 6-decimal USDT-family pattern.
- Whether `agent update` succeeds while an agent is still in its **first, not-yet-reviewed pending state** (as opposed to after a rejection, which is documented and empirically proven) is not stated either way by any source reached — `identity-update.md` explicitly: "it does not explicitly state whether updates can occur while an agent is pending initial review." No restriction is documented in the CLI schema either, but this specific state transition was never tested (this lane never runs a mutating command).
- Whether OKX forwards a verified caller identity/email, or a reusable cross-call authorization credential, to the ASP for A2MCP requests. No official source reached this session (CLI help across `agent`/`wallet`/`payment`; both fetched skill files) documents any such mechanism. `wallet login`/`wallet status` concern the **agent owner's own** Agentic Wallet session, not an end-caller's identity being forwarded to the ASP's endpoint — a different, unaddressed question.

### Findings summary update (supersedes the "Unresolved" list from Lane 7.4A/7.4A.1 §"Findings summary")

**Newly confirmed (official CLI + official skills repo, this session):**
- One agent may hold multiple, independently priced/endpointed A2MCP services (resolves "may Nobu register multiple differently priced listings" — as multiple *services* under one *agent*, not necessarily multiple *agents*).
- `agent update` never creates a new agent id; it re-triggers QA/review when a QA-governed field changes; it is documented and empirically proven to work after a rejection.
- x402 v2 header names/shapes and the general USDT-family/6-decimal settlement pattern, confirmed via the official CLI and official skill docs directly (not coordinator-provided this time).
- X Layer chain id 196, confirmed via a second independent official source.

**Still unresolved (unchanged, kept open):**
- Whether OKX forwards verified user identity/email to the ASP.
- Whether OKX forwards a reusable cross-call authorization credential.
- Whether `agent update` works during the first, not-yet-reviewed pending state (vs. only proven after rejection).
- The literal settlement asset/address for a real Nobu charge (coordinator-provided `OKX-XLAYER-EXAMPLE` only; not independently re-fetched).

## Lane 8R.0 — Official OKX seller integration sources (2026-07-20)

| ID | Source | Publisher | URL | Relevant decision | Checked | Status |
|---|---|---|---|---|---|---|
| OKX-PAYMENTS-REPO | OKX Payments SDK | OKX | https://github.com/okx/payments | Multi-language x402/MPP SDK; X Layer `eip155:196`; USD₮0; exact + aggr_deferred | 2026-07-20 | CONFIRMED (this session, GitHub API) |
| OKX-TS-SELLER | TypeScript Seller SDK reference | OKX | `github.com/okx/payments` → `typescript/SELLER.md` | Seller env vars (`OKX_API_KEY`/`OKX_SECRET_KEY`/`OKX_PASSPHRASE`/`PAY_TO`); X Layer only; `@okxweb3/x402-*` + facilitator | 2026-07-20 | CONFIRMED (this session, raw fetch) |
| OKX-FACILITATOR-CLIENT | OKXFacilitatorClient | OKX | `typescript/bu-payments/app-x402-core/src/facilitator/OKXFacilitatorClient.ts` | HMAC-SHA256 `OK-ACCESS-*` headers; `POST /api/v6/pay/x402/verify`; `POST /api/v6/pay/x402/settle`; `GET /api/v6/pay/x402/settle/status`; x402Version **2**; signature-only ≠ settle | 2026-07-20 | CONFIRMED (this session, raw fetch) |
| OKX-FACILITATOR-TYPES | Facilitator response types | OKX | `typescript/bu-payments/app-x402-core/src/types/facilitator.ts` | `isValid` verify; settle `status` pending/success/timeout; settle status pending/success/failed | 2026-07-20 | CONFIRMED (this session, raw fetch) |
| OKX-PAY-HTTP | Payments HTTP API | OKX | https://web3.okx.com/onchainos/dev-docs/payments/api-http | Seller 402 → sign → replay; path prefix `/api/v6/pay/x402` | prior coordinator + web index 2026-07-20 | CONFIRMED (indexed; DNS blocked for full page this session) |

**Integration selected (Lane 8R.0):** official authenticated HTTP APIs as implemented by `OKXFacilitatorClient` (not a third-party x402 guide). Next.js route keeps the existing activation saga; seller adapter only supplies a verified opaque settlement reference after verify+settle (or settle/status confirmation).

## Change procedure

When an official source changes:

1. record the old and new fact;
2. cite the exact official URL and check date;
3. identify affected contracts, tests, listing copy, and demo;
4. update machine-readable policy/data files;
5. add or update tests;
6. do not silently patch behavior in code only.
