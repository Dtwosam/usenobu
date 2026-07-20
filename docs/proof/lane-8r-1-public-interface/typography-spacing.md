# Typography and spacing verification

Source: `app/globals.css` CSS custom properties + Manrope via `next/font` in `app/layout.tsx`.

## Desktop type scale

| Role | Spec | Token |
|---|---|---|
| Hero | 56/60 · 700 | `--type-hero` |
| Section | 36/44 · 700 | `--type-section` |
| Card | 22/30 · 600 | `--type-card` |
| Lead | 19/30 · 400 | `--type-lead` |
| Body | 16/26 · 400 | `--type-body` |
| Support | 14/21 · 500 | `--type-support` |
| Button | 16/20 · 600 | `--type-button` |

## Mobile type scale (max-width 767px)

| Role | Spec |
|---|---|
| Hero | 40/44 |
| Section | 30/38 |
| Card | 20/28 |
| Lead | 17/27 |
| Body | 15/24 |

## Layout

| Token | Value |
|---|---|
| `--container-main` | 1160px |
| `--container-reading` | 720px |
| `--container-okx` | 760px |
| `--pad-desktop` / tablet / mobile | 32 / 24 / 20 |
| `--section-space-desktop` / tablet / mobile | 88 / 64 / 48 |
| `--card-gap` | 24px |
| `--card-pad` / mobile | 28 / 20 |
| `--control-min-height` | 48px |

Reduced-motion: global transition/animation collapse in `@media (prefers-reduced-motion: reduce)`.
