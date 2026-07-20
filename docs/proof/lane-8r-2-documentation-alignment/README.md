# Lane 8R.2 — Active product documentation alignment

**Verdict:** `NOBU_LANE_8R_2_PASS`  
**Base commit:** `c3615c4599ddcb756a07d6d22c8a1a6b5ec72355`  
**Sequence:** `8R.0 → 8R.1 → 8R.2 → 8R → 7.4G`

## Canonical product description

> Nobu is an AI post-purchase monitoring agent that monitors the exact product after purchase and alerts the customer when a safely matched lower price may create an opportunity to request the difference from the retailer.

Access: UseNobu website + OKX.AI. Target is the only retailer currently supported. More retailers are planned. Customer contacts the retailer; retailer verifies and decides.

## Changed-document inventory

| Document | Change |
|---|---|
| `app/page.tsx` | One homepage retailer sentence only |
| `README.md` | Full product-facing rewrite |
| `START-HERE.md` | Product description, source stack, architecture, active lane |
| `AGENTS.md` | Source stack without competition-era mandatory docs |
| `docs/nobu-product-overview.md` | **Created** |
| `docs/nobu-faq.md` | **Created** |
| `docs/nobu-okx-user-guide.md` | **Created** |
| `docs/nobu-current-state.md` | 8R.2 PASS; supersession notes; next Lane 8R |
| `docs/nobu-build-order.md` | 8R.1/8R.2 COMPLETE; Lane 8R expanded; Lane 9 product closeout |
| `docs/nobu-clean-master-spec.md` | Product definition + marketplace position |
| `docs/nobu-architecture.md` | Current production architecture section |
| `docs/nobu-ai-agent-contract.md` | Full free + paid action tables |
| `docs/nobu-okx-agent-native-paid-monitoring-architecture.md` | Status supersession banner |
| `docs/external-source-registry.md` | Active vs historical authority |
| `docs/nobu-hackathon-compliance-matrix.md` | HISTORICAL ONLY banner |
| `docs/nobu-submission-runbook.md` | HISTORICAL ONLY banner |
| `openapi/nobu-a2mcp.openapi.yaml` | All free agent actions |
| `openapi/nobu-agent-native-paid-monitoring-proposed.openapi.yaml` | Implemented+deployed; registration pending |

## Homepage retailer-copy proof

- Sentence: `Target is the only retailer currently supported. More retailers are planned for the future.`
- Location: availability section only (`data-testid="retailer-availability-sentence"`)
- Five main homepage sections retained
- Not repeated on `/okx`, `/notices`, `/purchases/new`, header, or footer

## README before/after summary

| Before | After |
|---|---|
| Lane 7.5E / 7.5B status | Points to current-state |
| Competition title in header | Product description first |
| Free-only / x402 later | Free + paid activation documented |
| Three-action agent | Full free action set + paid route |
| Tool workflow heavy | Brief; detail in START-HERE / AGENTS |

## Source-stack consistency

Mandatory active stack: master spec, current state, product overview, retailer/price governance, Target/SerpApi contracts, architecture, OKX architecture, both OpenAPI files, build order, test plan, threat model, external registry.

Historical-only (not mandatory engineering stack): competition matrix, submission runbook.

## Free-action contract consistency

All present in `openapi/nobu-a2mcp.openapi.yaml` and `docs/nobu-ai-agent-contract.md`:

UNDERSTAND_PURCHASE, CHECK_CONFIRMED_PURCHASE, CHECK_MONITORING_STATUS, DISCOVER_PRODUCT, CONFIRM_PRODUCT, BEGIN_EMAIL_VERIFICATION, VERIFY_EMAIL_CODE, PREFLIGHT_MONITORING, REVOKE_AGENT_CONNECTION, LIST_ACTIVE_MONITORS, ENABLE_EMAIL_ALERTS, DISABLE_EMAIL_ALERTS, STOP_MONITORING.

## Paid-contract consistency

`POST /v1/agent/start-monitoring`: x402 v2, eip155:196, USD₮0, 990000, server payTo, official OKX verify/settle/status, MONITORING_STARTED / ACTIVATION_PENDING / ALREADY_ACTIVE / PAYMENT_SETTLEMENT_PENDING, ASP registration pending Lane 8R. No `not_configured` always-on claim. Filename retained for reference stability.

## OpenAPI validation

Structural validation (Node file scan):

- Free: all 13 action consts present
- Paid: start-monitoring path, 990000, eip155:196, no `not_configured`, no “not deployed”
- YAML well-formed (parse via content presence / line counts)

Redocly recommended rules report pre-existing OAS 3.1 `nullable` style warnings/errors on historical schemas — not introduced as blocking product issues; structural action/status consistency is the lane gate.

## Scans

| Scan | Result |
|---|---|
| Stale deployment claims in active OpenAPI | PASS |
| Retailer overclaim | PASS (no “all retailers”) |
| Website retailer sentence uniqueness | PASS (app/page.tsx only) |
| Forbidden competition language in product docs | PASS for product prose; residual filename references to historical docs only |
| Sensitive output | PASS (no secrets/tokens/settlement refs in new docs) |

## External-link validation

OKX resource URLs retained from official registry / public `/okx` page (web3.okx.com onchainos docs). Target/SerpApi rows preserved in registry.

## Explicit non-actions

- No ASP `#5541` edit/resubmit  
- No genuine payment  
- No secrets in proof  
- Immutable historical proof bundles not rewritten  

## Next lane

**Lane 8R — Accurate update and resubmission of ASP #5541**
