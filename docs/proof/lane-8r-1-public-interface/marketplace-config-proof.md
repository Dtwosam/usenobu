# Marketplace configuration proof

Module: `src/web/okx-marketplace.ts`  
Component: `src/ui/OkxMarketplaceLink.tsx`  
Env: `NEXT_PUBLIC_OKX_MARKETPLACE_URL`

| Input | href | external |
|---|---|---|
| (absent) | `/okx` | false |
| `http://example.com/x` | `/okx` | false |
| `not a url` | `/okx` | false |
| `https://example.com/okx/nobu` | that URL | true |

CTA label (stable): **Use Nobu with OKX.AI**

Playwright (`/okx` and homepage): without env URL configured, CTAs resolve to `href="/okx"`.

No component hardcodes a marketplace listing URL.
