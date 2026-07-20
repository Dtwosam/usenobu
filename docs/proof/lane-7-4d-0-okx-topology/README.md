# Lane 7.4D.0 — Official OKX paid-service topology re-check

**Verdict:** `NOBU_LANE_7_4D_0_PASS`

Research and documentation only. No ASP was created, edited, or resubmitted.
No payment code was implemented or deployed.

## Source rule compliance

Only these were used as authority:

- The installed **official Onchain OS CLI** (`onchainos.exe`, v4.2.4,
  `%USERPROFILE%\.onchainos\bin\`, matching a published multi-platform
  `checksums.txt` release manifest) — inspected via `--help` **only**.
  See `onchainos-cli-help-redacted.txt`. No `create`/`update`/`activate`/
  `deactivate`/`upload`/any state-changing command was executed.
- The official **`github.com/okx/onchainos-skills`** repository — fetched
  directly this session. See `onchainos-skills-repo-findings.md`.
- This project's own prior **Lane 8 registration evidence**
  (`docs/proof/okx/`), as empirical corroboration of the CLI/skill schema
  claims (e.g. `gate5-update-avatar-redacted.json`).

Not used as authority for any OKX-specific claim: third-party x402/MCP
sources, forums, search summaries, or this environment's packaged
(non-official-repo) skills.

`web3.okx.com` and `www.okx.com` remained DNS-unreachable this session,
unchanged from Lane 7.4A/7.4A.1.

## The six questions

| # | Question | Resolution |
|---|---|---|
| 1 | May one Agentic Wallet/provider register multiple A2MCP listings with different prices/endpoints? | **Yes** — as multiple *services* on one *agent*. `agent create --help`/`agent update --help`: `--service` is a JSON array, each element with its own `serviceType`/`fee`/`endpoint`. `identity-register.md`: "multiple services per agent are fully supported." |
| 2 | Can ASP `#5541` be edited while pending, after approval, or only after rejection? | **After rejection: yes**, documented (`identity-update.md`: "Rejected listing → update the same agent") and empirically proven (this project's own Lane 8 avatar fix). **While still in its first, not-yet-reviewed pending state: not documented either way** — genuine gap, does not block the topology decision. Not tested (never executes a mutating command). |
| 3 | Does editing price/endpoint create a new Agent ID or force renewed review? | **No new Agent ID** (`identity-update.md`: "never create new"; empirically `newAgentId: null`). **Renewed review: yes**, when a "QA-governed field" changes (name, description, or any service create/update) — `identity-update.md`; matches `agent activate --help`'s "QA runs at register/update, not here." |
| 4 | Can Nobu preserve one free preparation listing and use a separate `$0.99` paid activation listing? | **Yes** — `agent update --service` is incremental (`operation: create/update/delete`); an existing service omitted from the delta is left untouched ("omission does NOT clear existing services"). A new paid A2MCP service can be added without touching the existing free service. |
| 5 | Current official one-time x402 contract for X Layer: SDK/package, headers, network, asset, decimals, amount? | **Partially resolved.** Mechanism: the official CLI's `payment pay`/`payment charge` themselves sign x402 v2 payloads (`PAYMENT-REQUIRED` → `{x402Version, resource, accepts}` → `PAYMENT-SIGNATURE`; or `WWW-Authenticate` challenge with `methodDetails`). Settlement shape: USDT-family asset, 6 decimals, confirmed by both the CLI (`fee`: "USDT implied, ≤6 decimals") and the official skill's decimals table. X Layer chain id `196`, confirmed by a second independent official source. **Not independently re-confirmed:** the literal `USD₮0` contract address and the exact `990000`-for-`$0.99` figure (remain coordinator-provided only, Lane 7.4A.1). |
| 6 | Does OKX forward identity/email or reusable cross-call credentials? | **Unresolved.** No official source reached (CLI help across `agent`/`wallet`/`payment`; both fetched skill files) documents this. `wallet login`/`status` concern the agent *owner's* own session, not a caller's identity forwarded to the ASP. |

## Decision

**Selected: separate free and paid A2MCP services, co-located under the
existing Agent `#5541` identity** (not a second ASP/Agent registration).

- The existing free A2MCP service (`https://usenobu.vercel.app/v1/agent`,
  fee `0`) stays exactly as-is.
- A new, independently priced/endpointed paid A2MCP service is added later
  (Lane 8R, after Lane 7.4D–7.4F are built and proven) via one
  `agent update --agent-id 5541 --service '[{"operation":"create",...}]'`
  call, omitting the existing service from the delta so it is never touched.

**Not selected — single-endpoint mixed free/paid:** no official evidence
found permits one service/endpoint to return `200` for some request bodies
and `402` for others; every service element has exactly one `fee` and one
`endpoint`. Treated as unsupported per the task's starting-evidence
instruction.

**Not selected — convert `#5541` to paid and relocate free preparation:**
unnecessary and strictly more disruptive once the multi-service path was
proven; would also require resolving the still-open "can `#5541`'s
*existing* price change under review" question, which the selected topology
never needs to answer (the free service's price is never changed).

## Corrections made this lane

- `docs/nobu-okx-agent-native-paid-monitoring-architecture.md` §10: the
  action table previously labelled every implemented Lane 7.4B/7.4C action
  "(proposed)" despite being implemented in the codebase and unit-tested. It
  now uses three honest tiers — **LIVE** (deployed, proof exists — the
  three original actions only), **IMPLEMENTED** (in the codebase, not
  deployment-proven — the six Lane 7.4B/7.4C actions), **PROPOSED / NOT
  IMPLEMENTED** (design only). The continuation-status table received the
  same correction, plus the statuses added by Lane 7.4B/7.4C
  (`CODE_INVALID`, `CODE_EXPIRED`, `CONNECTION_REVOKED`, `PRODUCT_CONFIRMED`,
  `CANDIDATE_NOT_CONFIRMABLE`, `POLICY_EXCLUSION`/`WINDOW_EXPIRED`/
  `POLICY_STALE`) that were missing from the table entirely.
- §3.1's numbered agent-flow steps for `DISCOVER_PRODUCT`, `CONFIRM_PRODUCT`,
  `BEGIN_EMAIL_VERIFICATION`, `VERIFY_EMAIL_CODE`, `PREFLIGHT_MONITORING`
  were each still marked "(free, proposed)" despite being implemented;
  corrected to "(free, IMPLEMENTED — Lane 7.4B/7.4C)".
- §5 rewritten from "unresolved, none selected" to the resolved decision
  above, with full evidence citations.
- §1/§2 updated with the six new confirmed facts and the narrowed remaining
  gaps.
- `docs/external-source-registry.md`: new "Lane 7.4D.0" section recording
  every source, exact finding, and what remains unresolved.
- `docs/nobu-build-order.md`, `docs/nobu-current-state.md`: Lane 7.4D.0
  marked COMPLETE/PASS with the resolved topology; next lane is 7.4D.

## Checks run

- Official-source citation consistency scan — every new claim in the
  architecture doc and registry cites a specific `OKX-CLI-HELP` or
  `OKX-SKILLS-*` id, or is explicitly marked coordinator-provided /
  unresolved. No third-party source cited for an OKX-specific fact.
- Unresolved-vs-confirmed contradiction scan — cross-checked that nothing
  newly marked CONFIRMED contradicts an item still listed as unresolved (the
  two narrowed gaps — pending-state update timing, identity/credential
  forwarding — appear consistently in both the registry and the
  architecture doc).
- Proposed OpenAPI parse — `openapi/nobu-agent-native-paid-monitoring-proposed.openapi.yaml`
  was inspected; the `/v1/agent/start-monitoring` path (already a separate
  path from `/v1/agent` in the proposed contract) is consistent with the
  selected topology, so only the `x-nobu-topology-status` field needed a
  factual update — no schema/shape change required. YAML re-parsed clean.
- `git diff --check` — clean.

## Hard locks preserved

- ASP `#5541` not created, edited, or resubmitted.
- No payment code implemented or deployed.
- No state-changing Onchain OS CLI command executed (help/schema only).
- No third-party x402/MCP source, forum, or search summary cited as
  authority for an OKX-specific fact.
