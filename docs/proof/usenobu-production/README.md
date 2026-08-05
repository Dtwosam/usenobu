# UseNobu production proof (Lane 7.5C)

| Field | Value |
|---|---|
| Product name | Nobu |
| Deployment identity | UseNobu |
| Vercel project | `usenobu` |
| Production URL | **https://www.usenobu.xyz** |
| Health service | `nobu-a2mcp` |

## Artifacts

| File | Purpose |
|---|---|
| `prod-health.json` | Public `GET /health` body |
| `prod-target-price-check.json` | Public `POST /v1/target-price-check` body (no secrets) |
| `production-verification.md` | Check matrix + accessibility notes |
| `rename-scan.txt` | Empty prior-brand scan output |
| `deployment-details.md` | Vercel project / alias notes |

## Public checks (2026-07-13)

- Homepage returns Nobu UI (no prior brand)
- `/health` → 200, `nobu-a2mcp`, SerpApi configured (boolean only)
- `/purchases/new`, `/dashboard`, `/notices` → 200
- `POST /v1/target-price-check` → 200 structured JSON
- No Vercel login / SSO required on www.usenobu.xyz
