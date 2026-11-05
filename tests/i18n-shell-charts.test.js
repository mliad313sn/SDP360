'use strict';
// C-26 (G27) — French for the chart accessibility layer (ChartTable / edvA11y in lib/chartTheme.js) and the Hygiene
// bullet table (lib/assetHygieneVisuals.js), through the same switch as the page dictionaries (ui_i18n_pages: boot.js
// marks <html data-i18n="on">, I18nText picks the language). Off (today) = byte-for-byte English. And the glossary
// docs/ux/GLOSSARY-FR.md: one French rendering per ITSM term, enforced on every dictionary.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.join(__dirname, '..');
const ChartTheme = require('../public/lib/chartTheme.js');
const AHV = require('../public/lib/assetHygieneVisuals.js');
const { ChartTable } = ChartTheme;

function loadCommon() {
  const ctx = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'public/lib/i18n/common.fr.js'), 'utf8'), ctx);
  return ctx.window;
}
function withLang(on, lang, fn) {
  const saved = { document: globalThis.document, I18nText: globalThis.I18nText, I18N_FR_CHARTS: globalThis.I18N_FR_CHARTS };
  globalThis.document = { documentElement: { dataset: on ? { i18n: 'on' } : {}, lang } };
  globalThis.I18nText = { lang: () => lang };
  globalThis.I18N_FR_CHARTS = loadCommon().I18N_FR_CHARTS;
  try { return fn(); } finally {
    for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete globalThis[k]; else globalThis[k] = saved[k]; }
  }
}
const spec = { title: 'Tickets', labels: ['Jan', 'Feb'], datasets: [{ label: 'Inbound', data: [3, null] }] };

test('chart table: English when the switch is off, even if the reader chose French', () => {
  const off = withLang(false, 'fr', () => [ChartTable.summary(spec), ChartTable.html(spec)]);
  assert.strictEqual(off[0], 'Tickets — 2 rows. Inbound: highest Jan (3), 1 not measured.');
  assert.match(off[1], /<summary>Data table<\/summary>/);
  assert.match(off[1], /<caption>Tickets — data table<\/caption>/);
});

test('chart table: French when the switch is on and the language is French (data values untouched)', () => {
  const [s, h, e, n, st, l] = withLang(true, 'fr', () => [ChartTable.summary(spec), ChartTable.html(spec),
    ChartTable.summary({ title: 'T', state: 'ERROR' }), ChartTable.html({ title: 'T', labels: [], datasets: [], state: 'NO_DATA' }),
    ChartTable.summary({ title: 'T', labels: ['a'], datasets: [{ data: [1] }], state: 'STALE' }), ChartTable.rows({ labels: ['a'], datasets: [{ data: [1] }] })]);
  assert.strictEqual(s, 'Tickets — 2 lignes. Inbound : maximum Jan (3), 1 non mesuré.');
  assert.match(h, /<summary>Tableau des données<\/summary>/);
  assert.match(h, /<caption>Tickets — tableau des données<\/caption>/);
  assert.match(e, /^T — données indisponibles/);
  assert.match(n, /Aucune donnée pour cette période/);
  assert.match(st, /^Source non à jour\./);
  assert.deepStrictEqual(l.head, ['Libellé', 'Valeur']);
  assert.deepStrictEqual(l.rows, [['a', '1']], 'labels and figures are data — never translated');
});

test('chart table: switch on but English chosen stays English', () => {
  assert.strictEqual(withLang(true, 'en', () => ChartTable.summary(spec)), 'Tickets — 2 rows. Inbound: highest Jan (3), 1 not measured.');
});

test('hygiene bullets: headers, caption and aria text localised; site names and figures untouched', () => {
  const rows = AHV.bulletRows([{ site: 'HGO', total: 10, owner_pct: 50, age_pct: null, cost_pct: 90, scan_pct: 100, completeness: 60 }]);
  const en = withLang(false, 'fr', () => AHV.bulletHtml(rows));
  assert.match(en, /<th scope="col">Owner<\/th>/);
  assert.match(en, /Completeness by site/);
  const fr = withLang(true, 'fr', () => AHV.bulletHtml(rows));
  assert.match(fr, /<th scope="col">Responsable<\/th>/);
  assert.match(fr, /<th scope="col" class="num">Actifs<\/th>/);
  assert.match(fr, /Complétude par site/);
  assert.match(fr, /aria-label="Date d’acquisition : non mesuré"/);
  assert.match(fr, /<th scope="row">HGO<\/th>/);
  assert.match(withLang(true, 'fr', () => AHV.bulletHtml([])), /Aucun actif/);
  const p = withLang(true, 'fr', () => AHV.paretoSpec({ state: 'VALID', rows: [] }));
  assert.deepStrictEqual(p.datasets.map((d) => d.label), ['Actifs signalés', 'Part cumulée']);
  assert.strictEqual(withLang(false, 'fr', () => AHV.paretoSpec(null)).title, 'Data-quality anomalies — Pareto');
});

test('every chart key used by the two libraries has a French entry, and no entry is unused', () => {
  const dict = loadCommon().I18N_FR_CHARTS;
  const src = ['public/lib/chartTheme.js', 'public/lib/assetHygieneVisuals.js'].map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  const used = [...src.matchAll(/\bL\('((?:[^'\\]|\\.)*)'/g)].map((m) => m[1].replace(/\\'/g, "'"))
    .concat(AHV.MEASURES.map((m) => m.label));   // passed as L(m.label)
  assert.ok(used.length >= 15, `L() keys found (${used.length})`);
  assert.deepStrictEqual(used.filter((k) => !(k in dict)), [], 'missing French chart strings');
  assert.deepStrictEqual(Object.keys(dict).filter((k) => !used.includes(k)), [], 'unused chart strings');
});

// ── Glossary ──────────────────────────────────────────────────────────────────────────────────────────────
function glossary() {
  const md = fs.readFileSync(path.join(ROOT, 'docs/ux/GLOSSARY-FR.md'), 'utf8').replace(/\r\n/g, '\n');
  const rows = [...md.matchAll(/^\| ([^|]+?) \| ([^|]+?) \|/gm)].map((m) => [m[1].trim(), m[2].trim()])
    .filter(([en]) => en !== 'English' && !/^-+$/.test(en));
  return rows;
}
test('glossary: exists, one row per English term, every French rendering non-empty', () => {
  const g = glossary();
  assert.ok(g.length >= 30, `glossary rows (${g.length})`);
  const seen = new Set();
  for (const [en, fr] of g) {
    assert.ok(!seen.has(en.toLowerCase()), `duplicate term ${en}`); seen.add(en.toLowerCase());
    assert.ok(fr.length > 0, `${en} has a French rendering`);
  }
});

test('glossary: every dictionary that translates a glossary term on its own uses the glossary rendering', () => {
  const g = new Map(glossary().map(([en, fr]) => [en.toLowerCase(), fr.replace(/\s*\(.*\)$/, '')]));
  const dir = path.join(ROOT, 'public/lib/i18n');
  const bad = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.fr.js'))) {
    const ctx = { window: {} };
    vm.runInNewContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx);
    for (const [name, d] of Object.entries(ctx.window)) {
      if (!d || typeof d !== 'object' || Array.isArray(d)) continue;
      for (const [k, v] of Object.entries(d)) {
        const want = g.get(String(k).trim().toLowerCase());
        if (want && String(v).toLowerCase() !== want.toLowerCase()) bad.push(`${f}:${name}: "${k}" → "${v}" (glossary: "${want}")`);
      }
    }
  }
  assert.deepStrictEqual(bad, []);
});
