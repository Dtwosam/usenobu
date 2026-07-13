# Final UI proof (Lane 7.5B3)

## Screenshots

| File | Viewport |
|---|---|
| `desktop-home.png` | 1440×1000 |
| `mobile-home.png` | 390×844 |
| `desktop-add-purchase.png` | 1440×1000 |
| `mobile-add-purchase.png` | 390×844 |
| `desktop-candidate-review.png` | 1440×1000 |
| `mobile-candidate-review.png` | 390×844 |
| `desktop-dashboard.png` | 1440×1000 |
| `mobile-dashboard.png` | 390×844 |
| `desktop-price-drop.png` | 1440×1000 |
| `mobile-price-drop.png` | 390×844 |
| `desktop-notices.png` | 1440×1000 |
| `mobile-notices.png` | 390×844 |
| `mobile-ambiguous.png` | 390×844 |
| `mobile-error-unsupported.png` | 390×844 |

## Other artifacts

- `qa-checklist.md` — issues found and fixed
- `axe-final-summary.json` — axe results
- `console-errors.json` — browser console check
- `production-verification.md` — public URL checks
- `prod-health.json` / `prod-target-price-check.json` — live responses

Regenerate screenshots:

```bash
npx playwright test tests/e2e/final-proof.spec.ts
```
