# ADR 0001 — Target + SerpApi MVP

**Status:** Accepted  
**Date:** 2026-07-13

## Decision

Build the original consumer AfterBuy product around eligible Target.com purchases. Use SerpApi Google Shopping as a provisional third-party observed price source.

## Reasons

- Target has a current official 14-day price-adjustment path for qualifying identical items.
- SerpApi provides a free bounded API plan without retailer affiliate approval.
- The combination enables automatic monitoring for a hackathon-scale proof.

## Consequences

- Prices must be labelled third-party observations.
- Product matching must fail closed.
- Target verifies and decides the final adjustment.
- Free-plan legal protection and volume are limited.
- No other retailer enters MVP scope.

## Revisit when

- a direct authorized retailer feed becomes available;
- SerpApi terms/pricing change;
- Target policy changes;
- live capability audit cannot reliably identify Target offers.
