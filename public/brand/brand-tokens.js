/**
 * Endeavour Mining brand tokens — JS mirror of public/_tokens.css.
 * Single source of truth for any code that runs in Node and produces
 * branded output (PPTX, PDF, image generators, email templates, etc.).
 *
 * The web side reads its tokens from public/_tokens.css. This file
 * exposes the same values to Node code via CommonJS require().
 *
 * Usage:
 *   const { EDV, C, FONTS, GOLDY } = require('./public/brand/brand-tokens');
 *
 *   // For NEW slides / brand-aligned output: use EDV directly.
 *   slide.addShape('rect', { fill: { color: EDV.orange }, ... });
 *
 *   // For LEGACY slides (slideHelpdeskMetrics1, slideMonthlyHelpdesk, etc.)
 *   // we re-export the existing palette under `C` so the migration is a
 *   // pure refactor — no visual change. Individual slides can graduate
 *   // from `C.orange` (legacy E87722) to `EDV.orange` (brand EF631A) over
 *   // time without a big-bang colour swap.
 *
 * Provenance: EDV Group Brand Guidelines — July 2022 (slides 9–15).
 *
 * Update protocol:
 *   - When `_tokens.css` changes a value, mirror it here in the same commit.
 *   - When this file changes a value, mirror it in `_tokens.css`.
 *   - The two sources MUST agree. A future build step can validate this.
 */
'use strict';

// pptxgenjs accepts hex colours WITHOUT the leading '#'. We strip it
// here once so callers can write `EDV.orange` and pass it directly.
const _hex = (s) => s.replace(/^#/, '');

// ── EDV BRAND PALETTE — from the corporate brand guidelines ────────────────
const EDV = {
  // Primary
  orange:        _hex('#EF631A'),     // PRIMARY brand colour — CTAs, accents, brand mark
  orangeDark:    _hex('#CA6419'),     // hover state for orange CTAs
  orange75:      _hex('#F79853'),
  orange50:      _hex('#FBB885'),

  blue:          _hex('#145FAE'),     // secondary action, links, informational
  blueDark:      _hex('#08629E'),
  blue75:        _hex('#5E8DCA'),
  blue50:        _hex('#8FABD9'),

  yellow:        _hex('#FFCD18'),     // branded surfaces only — fails contrast for status text
  yellowDark:    _hex('#D3B018'),

  green:         _hex('#1B9A3A'),     // success, RAG green
  greenDark:     _hex('#158D3E'),
  green75:       _hex('#69B76F'),
  green50:       _hex('#9BCB9A'),

  slate:         _hex('#3A4A60'),     // dark navy — header background
  slateDark:     _hex('#3A4B5E'),
  slate75:       _hex('#70798B'),

  grey:          _hex('#524F4E'),     // body text, dark UI elements
  greyDark:      _hex('#4F4D4C'),

  // Secondary
  teal:          _hex('#73C9DB'),     // light info accent
  lightGrey:     _hex('#C5C6C4'),     // borders, dividers
  red:           _hex('#D90038'),     // danger, RAG red

  // Status (semantic — for tables, RAG indicators)
  warning:       _hex('#D97706'),     // darker amber for status text — brand yellow fails contrast
  warningBg:     _hex('#FEF3C7'),

  // Neutrals
  white:         _hex('#FFFFFF'),
  black:         _hex('#000000'),

  // Surface tints for cards/panels
  surfaceLight:  _hex('#F4F5F7'),
  surfaceCard:   _hex('#FFFFFF'),
  surfaceBorder: _hex('#E2E5EA'),
};

// ── LEGACY PPTX PALETTE — preserved for backwards compatibility ────────────
// reports-weekly-pptx.js and reports-monthly-pptx.js previously defined this
// inline. Centralising it here means future colour tweaks happen in ONE file.
//
// IMPORTANT: do NOT change these values without an accompanying visual review
// of every slide in the four PPTX generators. The legacy palette is what the
// existing slide layouts were tuned for. A migration to EDV brand colours is
// a separate, deliberate change per slide family.
const C = {
  orange:    _hex('#E87722'),
  blue:      _hex('#1C3A5E'),
  darkGrey:  _hex('#333333'),
  midGrey:   _hex('#666666'),
  lightGrey: _hex('#F2F2F2'),
  white:     _hex('#FFFFFF'),
  green:     _hex('#2D9C4A'),
  red:       _hex('#D0312D'),
  amber:     _hex('#E87722'),
  tableHead: _hex('#1C3A5E'),
  highlight: _hex('#E8F4FD'),  // light blue — marks "current month" cells
};

// ── TYPOGRAPHY ─────────────────────────────────────────────────────────────
const FONTS = {
  // For PPTX text fields. PowerPoint falls back gracefully if the named font
  // isn't installed on the viewer's machine — Calibri is the universal Office
  // default so we use it as the last fallback.
  display:        'Franklin Gothic',
  body:           'Franklin Gothic',
  bodyFallback:   'Calibri',
  mono:           'Consolas',
};

// ── GOLDY MASCOT POSES ─────────────────────────────────────────────────────
// Web-relative paths (HTTP) for use in <img src="..."> and CSS background-image.
// Drop the actual PNGs in public/brand/goldy/ — see public/brand/README.md.
//
// If a pose file is missing, pages must degrade gracefully (display:none on
// the <img>, no JS error). The CSS class `.edv-goldy` and the empty-state
// component are designed to do that automatically.
const GOLDY = {
  welcomeSafety: '/brand/goldy/welcome-safety.png',
  academy:       '/brand/goldy/academy.png',
  values4ps:     '/brand/goldy/4ps-values.png',
  recruiting:    '/brand/goldy/recruiting.png',
  security:      '/brand/goldy/security.png',
};

// ── SPACING / RADIUS / SHADOW (for completeness — not all relevant in PPTX) ──
const SPACE  = { 1:4, 2:8, 3:12, 4:16, 5:20, 6:24, 8:32, 10:40, 12:48, 16:64 };
const RADIUS = { sm:4, md:6, lg:10, xl:14, pill:9999 };

module.exports = { EDV, C, FONTS, GOLDY, SPACE, RADIUS };
