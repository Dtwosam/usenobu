# Exact identity + Action Center proof

**Date:** 2026-07-15
**Public alias:** https://www.usenobu.xyz
**Deployment:** `usenobu-nmepx5b6q`
**Verdict:** `NOBU_IDENTITY_AND_ACTION_CENTER_PASS`

## Official Target route

| ID | URL | Checked |
|----|-----|---------|
| TARGET-POLICY | https://www.target.com/help/articles/policies-guidelines/price-match-guarantee | 2026-07-15 |
| TARGET-CONTACT | https://www.target.com/help/contact-us | 2026-07-15 |

Live Target help HTML returned a temporary capacity page during re-fetch; registry **CURRENT** entries unchanged. Action Center primary action opens **TARGET-CONTACT**.

## Production checks (`prod-proof.json`)

1. Missing model **and** UPC → Find my product disabled + error
2. TCIN + model → submit enabled
3. TCIN + UPC → submit enabled
4. AirTag full identity → `EXACT_MATCH_CANDIDATE` (LIVE)
5–7. Action Center (fixture e2e): heading, Request the difference from Target → contact-us, Copy request details, View evidence
8. No guarantee / claim-submission language

## Request-summary example (fixture)

```
Product: Example Widget Blue
Purchase date: 2026-07-01
Purchase price: $40.00
Observed Target price: $30.00
Potential difference: $10.00
Observation time: 2026-07-10T12:00:00.000Z
TCIN: 87654321
Model: WDG-100
Target product link: https://www.target.com/p/x/-/A-87654321
Policy deadline: 2026-07-15
Price source: third-party observation through SerpApi (not an official Target API)

Target verifies eligibility and makes the final decision. Nobu does not submit the request for you.
```

## Artifacts

- `prod-proof.json`
- `01-missing-model-upc.png`
- `04-airtag-review.png`
- `05-exact-identity-section.png`
- `06-action-center-fixture.png` (local e2e fixture price-drop)
