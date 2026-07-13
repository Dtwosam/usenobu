# Nobu Project Description

## Short description

Nobu is a post-purchase price-monitoring platform that watches supported purchases for possible retailer price drops. The current live integration supports eligible Target.com purchases.

## Full project description

Nobu is a consumer post-purchase price-monitoring platform and OKX.AI A2MCP ASP. It is designed to support retailer-specific connectors, policy contracts and price-monitoring workflows. The current live version supports eligible Target.com and Target app purchases only.

Add a supported purchase once. Nobu watches the retailer price during the applicable monitoring window and alerts you when there may be a difference to request.

For Target purchases, Nobu uses SerpApi as a third-party shopping-search observation source. It never describes this data as an official Target API price. Product matching is fail-closed: a lower price is accepted only when the seller is Target and the product identity is confirmed strongly enough under the matching contract.

Nobu does not guarantee refunds, log into retailer accounts, submit claims, scrape Target directly, or request payment-card information. For Target purchases, Target verifies the lower price and makes the final adjustment decision.

Other retailers remain unsupported until separately integrated and governed. The immediate build priority remains a stable public HTTPS A2MCP endpoint, deterministic Target policy and matching rules, scheduled price checks, recovery alerts, proof tests, and a live OKX.AI marketplace listing before broader retailer integrations.
