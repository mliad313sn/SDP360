# Endeavour Mining brand assets

This folder is the dashboard's home for everything brand-related.
It is the **single source of truth** for colours, typography, and
illustrations — both for the web side (HTML/CSS) and the Node side
(PPTX generators, PDF builders, server-rendered email).

## Layout

```
public/
├── _tokens.css           ← CSS custom properties, linked by every HTML page
├── brand/
│   ├── brand-tokens.js   ← JS mirror of _tokens.css for Node code
│   ├── edv-logo.png      ← logo on light background
│   ├── edv-logo-white.png← logo on dark background (header, login)
│   ├── README.md         ← this file
│   ├── fonts/            ← Franklin Gothic WOFF2 (when licenced) — see below
│   └── goldy/            ← Goldy mascot illustrations (5 poses) — see below
```

## Where to use what

| Surface | What to read tokens from | Example |
|---|---|---|
| HTML / CSS | `_tokens.css` via `var(--edv-orange)` | `color: var(--edv-orange);` |
| Inline `<style>` in HTML | Same — `var(--edv-orange)` | n/a |
| Server-side JS that produces PPTX | `require('./public/brand/brand-tokens')` | `EDV.orange` (no `#`) |
| Server-side JS that produces PDF / email | Same | `EDV.orange` (`#${EDV.orange}` if needed) |

## Two palettes — `EDV` (brand) and `C` (legacy)

`brand-tokens.js` exports two colour palettes:

- **`EDV`** — the corporate brand palette from the EDV Group Brand
  Guidelines (July 2022). Use this for any **new** slide / page / component.
- **`C`** — the legacy PPTX palette that the existing
  `slideHelpdeskMetrics1`, `slideMonthlyHelpdesk`, etc. were tuned with.
  Existing slides import this so the migration is a pure refactor with
  zero visual change.

Migrating an individual slide from `C` → `EDV` is a separate deliberate
change. Don't bulk-swap; review each slide visually as you do it.

## Goldy mascot — drop assets in `public/brand/goldy/`

The brand mascot has five canonical poses, used as defined in the
EDV brand book:

| Filename                     | Pose             | Where it appears in the dashboard                |
|------------------------------|------------------|---------------------------------------------------|
| `welcome-safety.png`         | Welcome / Safety | Login page hero, post-login splash                |
| `academy.png`                | Academy          | Help-page section dividers, onboarding tooltips   |
| `4ps-values.png`             | 4Ps Values       | Executive page hero, monthly report cover slide   |
| `recruiting.png`             | Recruiting       | Admin → Add User screen, sync trigger banner      |
| `security.png`               | Security         | 401/403 pages, password change, sign-off emails   |

**Source:** the original PNGs are on the EDV intranet brand pack.
Once delivered, drop them into `public/brand/goldy/` with the filenames
above. The dashboard's empty-state and login-hero components reference
those exact paths.

**Graceful fallback:** every component that uses Goldy is written to
hide the `<img>` if the file 404s, so the dashboard renders correctly
*right now* before the assets land — the brand experience just lights
up automatically once the files appear.

## Fonts — drop WOFF2s in `public/brand/fonts/`

The EDV primary typeface is **Franklin Gothic**. The web stack uses
the open-source equivalent **Libre Franklin** (Google Fonts) as the
fallback, which is loaded automatically by every page via:

```html
<link href="https://fonts.googleapis.com/css2?family=Libre+Franklin:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
```

If/when a licenced Franklin Gothic WOFF2 is provided, drop it in
`public/brand/fonts/` and add an `@font-face` declaration in
`_tokens.css`. The font stack already lists `'Franklin Gothic'` first,
so it'll start being used automatically.

## Update protocol

When a brand value changes (e.g. orange shade, type scale, spacing):

1. Update `_tokens.css` (web side).
2. Update `brand-tokens.js` (Node side) with the **same** value.
3. Single commit, both files. Don't let them drift.
