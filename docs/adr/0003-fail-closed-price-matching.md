# ADR 0003 — Fail-Closed Price Matching

**Status:** Accepted  
**Date:** 2026-07-13

## Decision

No automatic alert or positive eligibility result is produced from title similarity alone. A Target seller plus strong locked identifiers/model/variant match is required.

## Consequences

- Some valid opportunities will be missed rather than falsely reported.
- User confirmation is required at enrollment.
- Ambiguous provider results return review/no-reliable-price statuses.
