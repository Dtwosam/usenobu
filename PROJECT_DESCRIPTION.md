# Nobu Project Description

## Short description

Nobu is an AI agent that monitors supported purchases after checkout and alerts users when a lower retailer price may be available. Currently supports eligible Target.com purchases.

## Full project description

Nobu is a consumer AI agent and OKX.AI A2MCP ASP for post-purchase price monitoring. It understands natural-language purchase descriptions, requires user confirmation of structured details, then applies deterministic retailer policy and exact-product matching. The current live version supports eligible Target.com and Target app purchases only.

Tell Nobu what you bought once. After you confirm the details, Nobu watches the retailer price during the applicable monitoring window and alerts you when there may be a difference to request.

For Target purchases, Nobu uses SerpApi as a third-party shopping-search observation source. It never describes this data as an official Target API price. Product matching is fail-closed: a lower price is accepted only when the seller is Target and the product identity is confirmed strongly enough under the matching contract.

Nobu does not guarantee refunds, log into retailer accounts, submit claims, scrape Target directly, or request payment-card information. For Target purchases, Target verifies the lower price and makes the final adjustment decision.

Other retailers remain unsupported until separately integrated and governed. The immediate build priority remains a stable public HTTPS A2MCP endpoint, deterministic Target policy and matching rules, scheduled price checks, recovery alerts, proof tests, and a live OKX.AI marketplace listing before broader retailer integrations.
