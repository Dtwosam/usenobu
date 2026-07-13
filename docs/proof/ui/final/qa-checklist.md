# Lane 7.5B3 Visual QA checklist

**Date:** 2026-07-13  
**Compared to:** `docs/design/nobu-ui-reference.png`, `docs/nobu-ui-design-spec.md`  
**Pre-polish screenshots:** `docs/proof/ui/screens/`

## Issues found (pre-repair)

| ID | Severity | Area | Issue |
|---|---|---|---|
| V1 | High | Header | Hamburger menu visible on desktop (≥768px) — CSS order: `.n-icon-btn` overrode `display:none` |
| V2 | High | Header | Primary “Track a purchase” CTA also visible on mobile header next to menu — crowded, competing CTAs |
| V3 | High | Review | Raw enum `EXACT_MATCH_CANDIDATE` shown as primary result pill |
| V4 | Medium | Review / banners | “DEMO FIXTURE DATA” shouted in primary banner copy |
| V5 | Medium | Prices | Tabular numbers inconsistent across home vs price rows |
| V6 | Medium | Form | Demo scenario exposed as primary field for non-technical users |
| V7 | Medium | Layout | Main content max-width uneven vs design reading/form widths |
| V8 | Medium | Buttons | Mobile primary CTAs not consistently full-width in forms |
| V9 | Low | Copy | Fixture banner slightly verbose on review/alert |
| V10 | Low | Trust | SerpApi mention in primary inline notices — keep plain-English first |

## Pass criteria (post-repair)

- [x] First-screen clarity (hero + one primary CTA)
- [x] Visual hierarchy (eyebrow → H1 → lead → actions)
- [x] Spacing / alignment / card radius consistency
- [x] Typography + Manrope
- [x] Button hierarchy (primary dominant, secondary quiet)
- [x] Form usability (labels, hints, preserved errors)
- [x] Status clarity (plain English only in UI)
- [x] Mobile stacking + full-width CTAs where useful
- [x] No horizontal overflow 320–1440
- [x] Loading / empty / error / ambiguous states
- [x] Fixture “Demo data” labelling
- [x] Accessibility (axe serious/critical = 0)
- [x] Copy/trust (no guaranteed refund, no prior-brand UI strings)
