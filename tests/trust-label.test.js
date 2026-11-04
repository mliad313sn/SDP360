'use strict';
// B-03 — trust label on KPI tiles: certification state, source, formula and the DATA date.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const TL = require('../public/lib/trustLabel.js');
const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');

const ROW = { key: 'helpdesk.inbound', module: 'helpdesk', source: 'reports-db.getCalendarMonthlyHelpdesk',
  formula: 'COUNT created in the month', certification: 'not certified — KPI Committee approval not recorded', approved_at: null };

test('format: a null data date reads « date inconnue », never a date', () => {
  for (const d of [null, undefined, '', 0, 'garbage']) {
    const f = TL.format(ROW, d, 'fr');
    assert.match(f.short, /^Non certifié · date inconnue$/);
    assert.ok(f.full.endsWith('· date inconnue'));
    assert.ok(!/données au/.test(f.full));
  }
});

test('format: an uncertified registry row shows state, certification, source, formula and the data date', () => {
  const f = TL.format(ROW, '2026-11-03T10:05:00Z', 'fr');
  assert.equal(f.state, 'Non certifié');
  assert.equal(f.short, 'Non certifié · données au 03 nov. 2026 10:05 UTC');
  assert.equal(f.full, 'Non certifié · not certified — KPI Committee approval not recorded · reports-db.getCalendarMonthlyHelpdesk · COUNT created in the month · données au 03 nov. 2026 10:05 UTC');
  assert.equal(TL.format(ROW, 1762164300000, 'en').short, 'Not certified · data as of 03 Nov 2025 10:05 UTC');
});

test('format: absent key, unread registry, certified row', () => {
  assert.match(TL.format(null, null, 'fr').full, /^Non certifié · absent du dictionnaire des indicateurs · date inconnue$/);
  assert.match(TL.format(undefined, null, 'fr').short, /^Certification non lue/);
  const cert = { ...ROW, certification: 'certified', approved_at: '2026-12-01', approved_by: 'committee' };
  assert.equal(TL.format(cert, null, 'fr').state, 'Certifié');
  assert.equal(TL.isCertified(ROW), false, 'a row without an approval is never certified');
  assert.equal(TL.isCertified({ ...ROW, approved_at: '2026-12-01' }), false, 'the certification text still says not certified');
});

test('parseDate: sync_metadata text is UTC, empty and garbage are null', () => {
  assert.equal(TL.parseDate('2026-11-03 10:05:00').toISOString(), '2026-11-03T10:05:00.000Z');
  assert.equal(TL.parseDate('2026-11-03').toISOString(), '2026-11-03T00:00:00.000Z');
  assert.equal(TL.parseDate(0), null);
  assert.equal(TL.parseDate('nope'), null);
  assert.equal(TL.dataAsOf(null, 'fr'), 'Date des données inconnue');
  assert.equal(TL.dataAsOf(null, 'en'), 'Data date unknown');
  assert.equal(TL.dataAsOf('2026-11-03 10:05:00', 'en'), 'Data as of 03 Nov 2026 10:05 UTC');
});

// ── Minimal DOM: enough for apply() (querySelectorAll on [data-metric-key], attributes, children). ──
function fakeDoc() {
  const doc = { createElement: (tag) => mk(tag) };
  function mk(tag) {
    const e = { tagName: String(tag).toUpperCase(), nodeType: 1, attrs: {}, children: [], style: {}, textContent: '', className: '', ownerDocument: doc,
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
      setAttribute(k, v) { this.attrs[k] = String(v); },
      appendChild(c) { this.children.push(c); return c; },
      querySelectorAll(sel) {
        assert.equal(sel, '[data-metric-key]');
        const out = []; const walk = (n) => n.children.forEach((c) => { if (c.getAttribute('data-metric-key')) out.push(c); walk(c); }); walk(this); return out;
      } };
    return e;
  }
  doc.root = mk('main');
  return doc;
}

test('DOM: every tagged tile shows a certification string, accessible and idempotent', () => {
  const doc = fakeDoc();
  const tiles = ['helpdesk.inbound', 'helpdesk.closed', 'site.backlog'].map((k) => { const t = doc.createElement('div'); t.setAttribute('data-metric-key', k); doc.root.appendChild(t); return t; });
  tiles[1].setAttribute('data-metric-asof', '2026-11-02 08:00:00');
  doc.root.appendChild(doc.createElement('div'));            // an untagged node stays untouched
  TL._state.lang = 'fr';
  TL._state.registry = { 'helpdesk.inbound': ROW, 'helpdesk.closed': { ...ROW, key: 'helpdesk.closed' } };
  TL._state.dataDate = '2026-11-03T10:05:00Z';
  try {
    assert.equal(TL.apply(doc.root), 3);
    TL.apply(doc.root);                                      // a second pass must not add a second label
    for (const t of tiles) {
      const labels = t.children.filter((c) => c.getAttribute('data-trust-label') === '1');
      assert.equal(labels.length, 1);
      const l = labels[0];
      assert.match(l.textContent, /^Non certifié · /);
      assert.equal(l.getAttribute('tabindex'), '0');
      assert.equal(l.getAttribute('role'), 'note');
      assert.ok(l.getAttribute('aria-label').startsWith('Non certifié · '));
      assert.equal(l.getAttribute('title'), l.getAttribute('aria-label'));
    }
    assert.match(tiles[0].children[0].textContent, /03 nov\. 2026 10:05 UTC/);
    assert.match(tiles[1].children[0].textContent, /02 nov\. 2026 08:00 UTC/, 'a tile date wins over the page date');
    assert.match(tiles[2].children[0].getAttribute('aria-label'), /absent du dictionnaire/);
    assert.equal(doc.root.children[3].children.length, 0);
  } finally { TL._state.lang = null; TL._state.registry = undefined; TL._state.dataDate = null; }
});

test('pages: every KPI tile of index.html, exec-view.html and site-report is tagged, and the lib is loaded', () => {
  const idx = read('public/index.html');
  const cards = idx.match(/<div class="kpi-card"[^>]*>/g) || [];
  assert.equal(cards.length, 8);
  for (const c of cards) assert.match(c, /data-metric-key="[a-z0-9_.]+"/);
  assert.ok(idx.includes('<script src="lib/trustLabel.js"></script>'));
  assert.ok(!/'Data as of '\+new Date\(\)/.test(idx), 'the footer no longer prints the browser clock');
  assert.ok(!/footerTime'\)\.textContent=new Date\(\)/.test(idx));

  const ev = read('public/exec-view.html');
  assert.ok(ev.includes('<script src="lib/trustLabel.js"></script>'));
  assert.equal((ev.match(/<div class="kpi-card"' \+ mk \+ '>/g) || []).length, 2, 'both tile shapes carry the key');
  assert.ok(!/'<div class="kpi-card">/.test(ev), 'no untagged tile left');
  assert.equal((ev.match(/<div class="kpi-card"' \+ mk \+ '><div class="kpi-label">/g) || []).length, 1, 'the unavailable tile is tagged too');
  assert.equal((ev.match(/kpiCard\('[^']+', \w+, \{ key: 'exec\.[a-z_]+'/g) || []).length, 5);
  assert.ok(/TrustLabel\.init\(\{ registry: false, dataDate: data\.data_as_of/.test(ev), 'public page: no registry read, summary date');

  const sr = read('public/site-report.js');
  assert.ok(/'<div class="kpi" data-metric-key="'/.test(sr));
  assert.ok(read('public/site-report.html').includes('<script src="lib/trustLabel.js" defer></script>'));
});

test('registered keys used by the pages exist in the metric registry', () => {
  const reg = require('../services/metricRegistry');
  const seed = new Set((reg.SEED || []).map((m) => m.key));
  assert.ok(seed.size > 40);
  const idxKeys = (read('public/index.html').match(/data-metric-key="(helpdesk\.[a-z_]+)"/g) || []).map((s) => s.slice(17, -1));
  const registered = ['helpdesk.inbound', 'helpdesk.closed', 'helpdesk.first_reply_sla_pct', 'helpdesk.resolution_sla_pct'];
  for (const k of registered) { assert.ok(idxKeys.includes(k), k); assert.ok(seed.has(k), k); }
  const sr = read('public/site-report.js');
  const block = sr.slice(sr.indexOf('var METRIC_KEYS'), sr.indexOf('};', sr.indexOf('var METRIC_KEYS')));
  const vals = (block.match(/: '([a-z0-9_.]+)'/g) || []).map((s) => s.slice(3, -1));
  assert.ok(vals.length >= 8);
  for (const k of vals) assert.ok(seed.has(k), 'site-report key ' + k + ' is in the registry');
});
