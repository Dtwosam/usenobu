# Official `github.com/okx/onchainos-skills` repository — fetched findings

All URLs below were fetched directly by this session (`WebFetch`), successfully,
for the first time since Lane 7.4A (`web3.okx.com` / `www.okx.com` remained
DNS-unreachable throughout). No account, wallet, email, or transaction data
is involved — this is a public GitHub repository.

## `skills/okx-ai/references/identity-register.md`

> "All services ship in one `agent create`" — multiple services per agent
> are fully supported.

Service array fields confirmed: `serviceName` (5–30 char noun phrase),
`serviceDescription` (2-part: capability + required user inputs, ≤400 chars
total), `serviceType` (`"A2MCP"` or `"A2A"`), `fee` (plain numeric string,
USDT implied, ≤6 decimals), `endpoint` (API services only; `https://`,
publicly reachable, ≤512 chars, rejects `localhost`/private IPs/mock URLs).
Registration loop requires explicit "Add another service / Done" selection
before `validate-listing` runs once across the whole array.

## `skills/okx-ai/references/identity-update.md`

> "Rejected listing → update the same agent, never create new."

- Updating an agent **does not create a new agent id**.
- QA re-runs as "a single batch pass" only when role is `asp` AND a
  "QA-governed field changed" (agent name, description, or any service
  create/update entry) — validation rules identical to initial registration.
- Documented fix path for a rejected listing: `agent update` on the existing
  id → re-activate.
- **Does not state** whether updates can occur while an agent is pending its
  *first* review (as opposed to after a rejection).
- Service delta operations: `create` (new, no id), `update` (existing, needs
  id from `service-list`), `delete` (existing, needs id). "Send only the
  services that change... unchanged services are omitted."

## `skills/okx-ai/references/identity-invariants.md`

- No documented hard limit on service count.
- Role is immutable after creation (`update` has no `--role`).
- `pre-check` folds consent + uniqueness verification before `create`.
- No explicit statement that services must share one endpoint, or that
  endpoints must be independently priced — but the per-service `fee` field
  in the register/update schema is consistent with independent pricing.

## `skills/okx-agent-payments-protocol/SKILL.md`

- References the generic x402 protocol (`x402.org`) as the underlying
  standard the skill implements — noted here for completeness; per this
  project's existing source-purity rule, `x402.org` itself is still never
  cited as authority for an OKX-*specific* fact.
- A worked `WWW-Authenticate: Payment` decode example in the skill uses
  `chainId: 196` labelled "X Layer" — independently corroborating the
  previously coordinator-provided `eip155:196`.
- Amount conversion is delegated to `_shared/amount-display.md`.

## `skills/okx-agent-payments-protocol/_shared/amount-display.md`

Settlement decimals table:

| Token | Decimals | Atomic units for $1.00 |
|---|---|---|
| USDC | 6 | 1,000,000 |
| USDT | 6 | 1,000,000 |
| USDG | 6 | 1,000,000 |
| ETH | 18 | 1,000,000,000,000,000,000 |

Conversion rule: `human = atomic / 10^decimals`. Worked example given for a
$0.99 stablecoin charge (USDC/USDT/USDG, all 6 decimals): atomic
`990000`, display `"0.99 USDC (990000)"`.

**Does not** list "X Layer" or "USD₮0" as a named row — for tokens absent
from this table, the guidance is to query `okx-dex-market` for the live
decimal count rather than assume a value. The literal `USD₮0` asset address
`0x779ded0c9e1022225f8e0630b35a9b54be713736` from the coordinator-provided
`OKX-XLAYER-EXAMPLE` (Lane 7.4A.1) is **not** independently re-confirmed by
this specific file — only the general USDT-family/6-decimal/atomic-unit
pattern is.
