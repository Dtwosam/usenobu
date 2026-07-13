# Historical AfterBuy proof (immutable archives)

This folder retains **original AfterBuy-era** proof artifacts and hostnames so Git history and prior hackathon evidence remain auditable.

**Active product name is Nobu.** Do not treat files here as current branding.

## Why this folder exists

Lane 7.5A globally renamed the project to **Nobu**. Per rename rules:

- Active code and active documentation must not contain `afterbuy` / `AfterBuy` / `AFTERBUY`.
- Original production curl proofs, SerpApi live fixtures, and deployment hostname evidence keep their historical names and contents here.

## Contents

| Path | What it preserves |
|---|---|
| `a2mcp/` | Lane 7 public HTTPS curl archives, closeout notes, production readiness repair proof |
| `serpapi/` | Lane 3 offline/live capability and repair audit redacted fixtures |

## Retained historical occurrences (by design)

The following strings **intentionally remain** only inside this directory (and immutable Git commits):

- Brand: `AfterBuy`, `afterbuy`, `AFTERBUY`
- Service id in archived responses: `afterbuy-a2mcp`
- Historical production hostname: `https://afterbuy.vercel.app`
- Historical env names in archived notes (if any): `AFTERBUY_*`
- Historical lane verdict labels in archived narratives: `AFTERBUY_LANE_*`
- Historical file basenames inside archives (e.g. older report titles)

### Path-pointer exception (active docs)

The folder name `historical-afterbuy` is required by Lane 7.5A. Active docs may **only** retain the prior brand as the path string `docs/proof/historical-afterbuy/` when pointing at this archive (README, MANIFEST, build order, current state, OpenAPI server note). No other active brand usage is allowed.

## Active project pointers

| Concern | Active location |
|---|---|
| Specs | `docs/nobu-*.md` |
| OpenAPI | `openapi/nobu-a2mcp.openapi.yaml` |
| ChatGPT combined source | `NOBU_CHATGPT_PROJECT_SOURCE.md` |
| Build order | `docs/nobu-build-order.md` (includes Lane 7.5A/7.5B) |
| Current state | `docs/nobu-current-state.md` |

## Do not

- Re-introduce these archives into active docs without renaming.
- Treat historical hostnames as the required live brand after Vercel re-alias (if/when the public hostname changes, update **active** OpenAPI servers only).
