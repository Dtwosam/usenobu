# Nobu Target Identity Acquisition Contract

Status: active
Lane: 8-R2C
Date: 2026-07-19

## Purpose

Nobu enrollment starts from the smallest safe user input:

- Target product URL
- purchase price
- purchase date

Model number, UPC/GTIN, and manually entered TCIN are progressive fallback signals. They are requested only when deterministic Target discovery cannot safely confirm one exact item.

## Target URL parser

The parser is deterministic and performs no network requests.

It accepts only HTTPS `target.com` product URLs that include a Target item number in a supported `A-<TCIN>` form. It preserves the original submitted URL in parser output, normalizes the stored Target URL by dropping query parameters and fragments, extracts the TCIN, and exposes bounded slug tokens as weak product-name context.

Parser failure codes:

- `INVALID_TARGET_URL`: malformed URL, non-HTTPS URL, or non-Target domain.
- `UNSUPPORTED_TARGET_URL`: Target URL shape is not a supported product URL.
- `TARGET_IDENTIFIER_MISSING`: Target URL does not expose an `A-<TCIN>` identity.

The parser never follows shortened links or redirects, never fetches Target pages, and never treats arbitrary URL text as authoritative product identity.

## Discovery cascade

Enrollment discovery uses the existing SerpApi Google Shopping connector, existing normalizer, existing Target seller filtering, existing matching engine, and at most one existing Immersive Product enrichment.

The bounded cascade is:

1. Normalize Target URL and derive TCIN.
2. Use bounded slug tokens as product-name query context when available.
3. Search SerpApi Google Shopping with the governed query builder.
4. Filter to Target seller and exclude Target Plus.
5. Evaluate candidates with the deterministic matching hierarchy.
6. Use one Immersive Product enrichment only when Shopping evidence is unresolved.
7. Ask for one additional model or UPC signal only when exact identity remains incomplete.

Google Shopping `product_id` is recorded as third-party provenance only. It is never used as a Target TCIN.

## Matching hierarchy

Confirmation remains fail closed:

1. Exact Target URL or exact TCIN.
2. Exact manufacturer model plus Target seller and compatible variant.
3. Exact UPC/GTIN plus Target seller.
4. Title-only similarity is never confirmable.

The user must confirm the exact product once before monitoring starts. Later monitoring uses the locked fingerprint only.

