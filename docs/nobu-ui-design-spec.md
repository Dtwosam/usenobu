# Nobu UI Design Spec (Lane 7.5B1)

**Status:** Design foundation locked  
**Scope:** Tokens, shell, and reusable components only  
**Next:** Lane 7.5B2 — complete screen implementation  

Reference direction: green-and-cream consumer UI (visual hierarchy, cards, controls). Product schemas, Target policy, matching, monitoring, SerpApi, and A2MCP contracts remain authoritative — do not invent fields or behavior from mockups.

## UX rules (locked)

1. **One primary action** per screen (default: *Track a purchase*).
2. **Plain English** first; technical detail only under progressive disclosure.
3. **No raw enums or provider jargon** as main copy (e.g. avoid leading with `EXACT_MATCH_CANDIDATE` or “SerpApi” without plain context).
4. **Never ask** for information Nobu does not use.
5. **Fewest reasonable steps** for important tasks.
6. **Progressive disclosure** for policy, provenance, and technical evidence.
7. **Preserve form data** after validation errors.
8. **Explain disabled actions** (`disabledReason` / `title` / helper text).
9. **Every error** says what to do next.
10. **No fake activity**, savings, users, testimonials, or live data.
11. **No guaranteed-refund** language. Target decides.

## Brand

- Product name: **Nobu**
- Wordmark: original text + simple **N** mark (not affiliated with any third-party “Nobu” brand)
- Tone: calm, clear, trustworthy, first-time-user friendly

## Design tokens

### Color

| Token | Value | Role |
|---|---|---|
| `--canvas` | `#F6F5F0` | Page background |
| `--surface` | `#FFFFFF` | Cards, header, footer |
| `--surface-subtle` | `#FAFAF7` | Nested surfaces |
| `--ink` | `#161A17` | Primary text |
| `--text-secondary` | `#626A65` | Supporting text |
| `--text-tertiary` | `#5C635E` | Meta / quiet (AA on canvas) |
| `--border` | `#E2E5DF` | Default borders |
| `--border-strong` | `#CCD2CB` | Control borders |
| `--brand` | `#1F5A4A` | Primary actions |
| `--brand-hover` | `#174638` | Hover |
| `--brand-active` | `#10392E` | Active |
| `--brand-soft` | `#E4EFEA` | Soft brand fills |
| `--accent` | `#B69A62` | Accent (restrained) |
| `--success` / `--success-soft` | `#197552` / `#E5F3EC` | Positive status |
| `--warning` / `--warning-soft` | `#7A4F12` / `#F8EFD9` | Caution / demo (AA pair) |
| `--danger` / `--danger-soft` | `#B3443B` / `#F9E8E6` | Errors |

### Typography

- Family: **Manrope** via `next/font` (weights 400, 500, 600, 700)
- Body: 16px minimum; inputs ≥ 16px

### Spacing

`4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96` → `--space-1` … `--space-24`

### Radii

| Token | Value |
|---|---|
| `--radius-sm` | 10px |
| `--radius-control` | 14px |
| `--radius-card` | 22px |
| `--radius-lg` | 28px |
| `--radius-pill` | 999px |

### Layout

| Token | Value |
|---|---|
| `--container-main` | 1200px |
| `--container-reading` | 720px |
| `--container-form` | 640px |
| Mobile / tablet / desktop pad | 20 / 32 / 40px |

### Controls

- Min height: **48px**
- Touch target: **44×44px**
- States: hover, active, focus-visible, disabled, loading, error
- Soft shadows only; no glassmorphism, neon, heavy gradients, or excessive motion
- `prefers-reduced-motion` respected

## Component inventory

| Component | Path | Notes |
|---|---|---|
| Header | `src/ui/Header.tsx` | Wordmark, nav, mobile menu, primary CTA |
| Footer | `src/ui/Footer.tsx` | Disclaimer + links |
| Button / ButtonLink | `src/ui/Button.tsx` | primary, secondary, ghost, danger |
| IconButton | `src/ui/IconButton.tsx` | 44×44 minimum |
| Card | `src/ui/Card.tsx` | Elevated surface |
| Input / Select / DateInput / CurrencyInput | `src/ui/*` | Shared control styling |
| Field / FormError | `src/ui/Field.tsx`, `FormError.tsx` | Labels, hints, errors |
| Badge / StatusBadge | `src/ui/*` | Plain-English status only |
| DemoDataBanner | `src/ui/DemoDataBanner.tsx` | Fixture labelling |
| InlineNotice | `src/ui/InlineNotice.tsx` | info/success/warning/danger |
| PageHeader / SectionHeader | `src/ui/*` | Hierarchy |
| Stepper | `src/ui/Stepper.tsx` | Multi-step progress |
| ProductCard / PriceSummary | `src/ui/*` | Display building blocks |
| EmptyState / LoadingSkeleton | `src/ui/*` | Empty & loading |
| Disclosure | `src/ui/Disclosure.tsx` | Progressive disclosure |
| Icons | `src/ui/icons.tsx` | One original stroke family |

Styles live in `app/globals.css` (single token + component system). Legacy `.card` / `.btn` classes map to the same tokens until Lane 7.5B2 rewrites screens.

## Global shell

- Skip-to-content link
- Sticky header with original **N** wordmark
- Desktop nav + responsive mobile panel
- Primary CTA: **Track a purchase** → `/purchases/new`
- Footer with privacy-safe disclaimer
- Landmarks: `header`, `main#main-content`, `footer`

## Accessibility

- WCAG AA contrast targets for brand/ink on canvas/surface
- Visible `:focus-visible` rings
- Keyboard-operable header menu (Escape closes)
- Labels associated via `htmlFor` / `id`
- Semantic landmarks
- No horizontal overflow goal at 320px; usable at 200% zoom
- Breakpoints of interest: 320, 390, 768, 1024, 1440

## Proof artifacts

- Gallery: `/design/foundation`
- Screenshots & a11y notes: `docs/proof/ui/foundation/`

## Out of scope (this lane)

- Full product screen redesign (home, add purchase, review, dashboard, alerts)
- Schema, policy, matching, monitoring, SerpApi, DB, A2MCP route changes
- OKX registration (Lane 8)
