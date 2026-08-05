# Production verification (superseded by UseNobu)

**Current primary production URL:** https://www.usenobu.xyz

This note remains only as a Lane 7.5B3 timeline marker. Authoritative UseNobu verification lives in:

`docs/proof/usenobu-production/`

| Check | Expected |
|---|---|
| GET / | Nobu UI |
| GET /health | `service: nobu-a2mcp` |
| POST /v1/target-price-check | Structured JSON, no secrets |
