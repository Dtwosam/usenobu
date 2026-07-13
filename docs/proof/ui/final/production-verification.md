# Production verification (Lane 7.5B3)

**Primary production URL:** https://afterbuy.vercel.app  
**Deployment:** https://afterbuy-hvj2pbrmg-dtwoflicks-2878s-projects.vercel.app  
**Preferred alias https://nobu.vercel.app:** unavailable (already in use by third party)  
**Additional Nobu aliases assigned:** nobu-mvp.vercel.app, nobu-price.vercel.app, nobu-watch.vercel.app, get-nobu.vercel.app, nobu-app.vercel.app  
**Note:** New `*.vercel.app` aliases may hit Vercel SSO/protection (HTTP 302 to login). The stable public production hostname remaining in use is **https://afterbuy.vercel.app** (UI brand: Nobu; health service: `nobu-a2mcp`).

## Checks (afterbuy.vercel.app)

| Check | Result |
|---|---|
| GET / | 200, Nobu UI ("Bought it?", "Track a Target purchase"), no prior-brand UI strings |
| GET /purchases/new | 200 |
| GET /dashboard | 200 |
| GET /notices | 200 |
| GET /health | 200, service `nobu-a2mcp`, serpapi_configured true |
| POST /v1/target-price-check | 200, structured status (example MATCH_REVIEW_REQUIRED), no secrets |

Artifacts: `prod-health.json`, `prod-target-price-check.json`
