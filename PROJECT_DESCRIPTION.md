# AfterBuy Project Description

## Short description

AfterBuy is a post-purchase price-drop monitoring service for recent eligible Target.com purchases. A user adds a purchase once, and AfterBuy checks third-party shopping-search observations during Target's 14-day price-adjustment window. When a confident exact-product match shows a lower Target price, AfterBuy calculates the potential difference, shows the time remaining, and guides the user to Target's official request route.

## Full project description

AfterBuy is being built for the OKX.AI Genesis Hackathon as a free A2MCP service with a small consumer web interface. The MVP supports eligible Target.com and Target app purchases in the supported U.S. scope defined by the source of truth.

AfterBuy uses SerpApi as a third-party shopping-search observation source. It never describes this data as an official Target API price. Product matching is fail-closed: a lower price is accepted only when the seller is Target and the product identity is confirmed strongly enough under the matching contract.

AfterBuy does not guarantee refunds, log into Target accounts, submit claims, scrape Target directly, or request payment-card information. Target verifies the lower price and makes the final adjustment decision.

The immediate build priority is a stable public HTTPS A2MCP endpoint, deterministic Target policy and matching rules, scheduled price checks, recovery alerts, proof tests, and a live OKX.AI marketplace listing before broader features or additional retailers are considered.
