'use strict';
// Step 6 (lot 6.7) — static AA audit of the step-6 pages (dossier §4.4): every text colour of dashboard.css,
// resolved through the real tokens of _tokens.css, reaches 4.5:1 on its own background (or on white AND the page
// background when the rule sets none); page and renderer semantics. The tool-assisted pass (axe-core) and the
// manual screen-reader pass stay in docs/ops/USABILITY-TEST-PROTOCOL.md — this test keeps the CSS from drifting.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
// Every stylesheet of the 2.0 pages (step 6 onwards). A new one is added here.
const CSS_FILES = ['public/dashboard.css', 'public/trackers.css', 'public/cockpit.css', 'public/field.css'];
const CSS = CSS_FILES.map(read).join('\n');

// The FIRST definition of each custom property (the light theme :root).
const TOKENS = {};
for (const m of read('public/_tokens.css').matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) if (!(m[1] in TOKENS)) TOKENS[m[1]] = m[2].trim();

function resolve(v, depth = 0) {
  v = String(v).replace(/!important/, '').trim();
  const m = v.match(/^var\(\s*(--[\w-]+)\s*(?:,\s*(.+))?\)$/);
  if (m && depth < 8) return TOKENS[m[1]] != null ? resolve(TOKENS[m[1]], depth + 1) : (m[2] ? resolve(m[2], depth + 1) : null);
  if (/^#[0-9a-f]{3}$/i.test(v)) return ('#' + v.slice(1).split('').map(c => c + c).join('')).toUpperCase();
  return /^#[0-9a-f]{6}$/i.test(v) ? v.toUpperCase() : null;
}
const lum = (hex) => {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(x => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

function rules() {
  const out = [];
  for (const m of CSS.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decl = {};
    for (const d of m[2].split(';')) { const i = d.indexOf(':'); if (i > 0) decl[d.slice(0, i).trim()] = d.slice(i + 1).trim(); }
    out.push({ selector: m[1].trim(), decl });
  }
  return out;
}

test('contrast helper matches the WCAG reference values', () => {
  assert.strictEqual(ratio('#000000', '#FFFFFF').toFixed(1), '21.0');
  assert.ok(Math.abs(ratio('#EF631A', '#FFFFFF') - 3.25) < 0.02, 'the brand orange is 3.25:1 on white');
  assert.ok(Math.abs(ratio('#B4510F', '#FFFFFF') - 5.09) < 0.02);
});

test('every text colour of the 2.0 stylesheets reaches 4.5:1 on its background', () => {
  const PAGE = resolve('var(--color-bg, #F4F5F7)'), WHITE = '#FFFFFF';
  const fails = [], checked = [];
  for (const r of rules()) {
    if (r.selector.includes('::before') || r.selector.includes('::after')) continue;
    const raw = r.decl.color;
    if (!raw || /inherit|currentcolor|transparent/i.test(raw)) continue;
    const fg = resolve(raw);
    assert.ok(fg, `${r.selector}: colour "${raw}" does not resolve to a hex value`);
    const bgRaw = r.decl['background-color'] || r.decl.background;
    const bgs = bgRaw ? [resolve(bgRaw)] : [WHITE, PAGE];
    assert.ok(bgs.every(Boolean), `${r.selector}: background "${bgRaw}" does not resolve to a hex value`);
    const worst = Math.min(...bgs.map(b => ratio(fg, b)));
    checked.push(r.selector);
    if (worst < 4.5) fails.push(`${r.selector}: ${fg} on ${bgs.join('/')} = ${worst.toFixed(2)}:1`);
  }
  assert.ok(checked.length >= 30, `the audit really ran (${checked.length} rules)`);
  assert.deepStrictEqual(fails, [], 'text below AA');
});

test('focus is always visible and motion respects the reduced-motion preference', () => {
  assert.match(CSS, /:focus-visible[^{]*\{[^}]*outline:\s*3px solid/);
  assert.ok(!/outline:\s*(none|0)\b/.test(CSS), 'no rule removes the focus outline');
  for (const m of CSS.matchAll(/(transition|animation)\s*:/g)) {
    const before = CSS.slice(0, m.index), open = before.lastIndexOf('@media');
    assert.ok(open >= 0 && /prefers-reduced-motion:\s*no-preference/.test(before.slice(open, open + 60)), 'motion only under no-preference');
  }
});

test('every 2.0 page (services/pages.js): language, one main landmark, a title, a live region for the loaded content', () => {
  for (const f of require('../services/pages').V2_PAGES.map(p => 'public/' + p[0])) {
    const h = read(f);
    assert.match(h, /<html lang="fr">/, f);
    assert.strictEqual((h.match(/<main\b/g) || []).length, 1, f);
    assert.match(h, /<title>[^<]{3,}<\/title>/, f);
    assert.match(h, /name="viewport"/, f);
    assert.match(h, /aria-live="polite"/, f);
  }
});

test('renderer: one heading per widget, tables with header scopes, RAG in words, charts said in words', () => {
  const R = require('../public/lib/dashboardRender');
  const d = { title: { fr: 'T' }, widgets: [
    { id: 'k', type: 'kpi', span: 12, title: { fr: 'K' } },
    { id: 't', type: 'trend', span: 6, title: { fr: 'Tendance' } },
    { id: 'tb', type: 'table', span: 12, title: { fr: 'Sites' } },
  ] };
  const html = R.render(d, { context: { scope: 'group', month: '2026-10' }, widgets: {
    k: { domains: [], prev_month: '2026-09', items: [{ key: 'a', label: { fr: 'SLA' }, unit: '%', value: 91, rag: 'green', policy: 'sla_pct' }] },
    t: { domains: [], series: [{ key: 'a', label: { fr: 'SLA' }, unit: '%', points: [{ label: 'S1', value: 80 }, { label: 'S2', value: null }, { label: 'S3', value: 88 }] }] },
    tb: { domains: [], columns: [{ key: 'a', label: { fr: 'SLA' }, unit: '%' }], rows: [{ code: 'A', name: 'Alpha', cells: [{ value: 91, rag: 'green' }] }], total: [{ value: 91, rag: 'green' }] },
  } }, { lang: 'fr' });
  assert.strictEqual((html.match(/<h2\b/g) || []).length, 3, 'one h2 per widget, under the page h1');
  assert.match(html, /aria-labelledby="dbw-k"/);
  assert.match(html, /<th scope="col"/);
  assert.match(html, /<th scope="row"/);
  assert.ok(/91\s%<\/span><span class="db-sr"> \(Dans l(’|&#39;)objectif\)<\/span>/.test(html), 'a coloured cell says its state in words');
  assert.match(html, /class="db-pill db-green">Dans l(’|&#39;)objectif</, 'green written in words');
  assert.match(html, /<svg[^>]*aria-hidden="true"/);
  assert.match(html, /<p class="db-sr">SLA sur 3 points : de 80\s% à 88\s% \(hausse\)\.<\/p>/, 'the chart is said in words');
  assert.match(CSS, /\.db-sr\s*\{[^}]*clip:/, 'the words are visually hidden, not display:none');
  const empty = R.render({ title: { fr: 'T' }, widgets: [{ id: 'e', type: 'trend', span: 6, title: { fr: 'E' } }] },
    { context: {}, widgets: { e: { domains: [], series: [{ key: 'a', label: { fr: 'SLA' }, unit: '%', points: [{ label: 'S1', value: null }] }] } } }, { lang: 'fr' });
  assert.match(empty, /<p class="db-sr">SLA : Aucune donnée sur la période\.<\/p>/, 'one full stop, not two');
});
