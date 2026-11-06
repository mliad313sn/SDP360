'use strict';
// E-V03 — the standard state vocabulary + the KPI base line (switch ui_kpi_base_line, default '0').
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const SB = require('../public/lib/stateBadge');
const DR = require('../public/lib/dashboardRender');
const KC = require('../public/lib/kpiCard');

test('the ten states of audit §5.3 exist, each with a symbol, a text and an accessible name', () => {
  assert.deepEqual(SB.KEYS, ['loading', 'no-data', 'not-measured', 'stale', 'unmonitored', 'error', 'no-right', 'uncertified', 'export-in-progress', 'publication-blocked']);
  for (const k of SB.KEYS) {
    const html = SB.badge(k);
    assert.ok(SB.symbol(k) && SB.text(k) && SB.aria(k), k);
    assert.match(html, new RegExp('role="status" aria-label="' + SB.aria(k)), k);
    assert.ok(html.includes(SB.symbol(k)) && html.includes(SB.text(k)), k + ': symbol AND text, never colour alone');
  }
  assert.throws(() => SB.badge('nope'), /unknown state/);
  assert.match(SB.badge('error', { detail: '<b>x</b>' }), /&lt;b&gt;x&lt;\/b&gt;/, 'detail is escaped');
});

test('existing state texts are byte-identical to before (pinned)', () => {
  assert.equal(KC.NOT_MEASURED, '— not measured');
  assert.equal(DR.staleBadge({ freshness: 'STALE' }), '<div class="edv-stale-badge">Source not current — colour withheld</div>');
  assert.equal(DR.staleBadge({ freshness: 'UNKNOWN' }), '<div class="edv-stale-badge">Source never synced — colour withheld</div>');
  assert.equal(DR.ragDot('NA'), '<span class="edv-rag-dot rag-na" role="img" aria-label="not measured"></span>');
  assert.equal(DR.ragDot('GREEN', 'STALE'), '<span class="edv-rag-dot rag-na rag-stale" role="img" aria-label="stale source, colour withheld">–</span>');
  assert.equal(DR.ragDot('GREEN', 'UNKNOWN'), '<span class="edv-rag-dot rag-na rag-stale" role="img" aria-label="source never synced, colour withheld">–</span>');
});

test('kpiCard with the switch off is byte-identical to today; on adds the base line; base null ≠ 0', () => {
  const d = { label: 'Closure rate', value: 84, unit: '%', rag: 'GREEN', base: { n: 142, label: 'tickets created' } };
  const off = KC.kpiCard(d);
  assert.equal(off, KC.kpiCard(Object.assign({}, d, { base: undefined })), 'off: the base is not shown');
  assert.ok(!off.includes('n = '));
  const on = KC.kpiCard(d, { baseLine: true });
  assert.match(on, /<div class="edv-kpi-base">n = 142 tickets created<\/div>/);
  const none = KC.kpiCard(Object.assign({}, d, { base: null }), { baseLine: true });
  assert.match(none, /base not measured/); assert.ok(!/n = 0/.test(none));
  assert.match(DR.baseLine({ base: { n: 0, label: 'assets in register' } }), /n = 0 assets in register/, 'a measured zero base is a zero');
});

test('action link: relative only, rendered as "→ act"; unsafe href renders nothing', () => {
  assert.equal(DR.actionLink('site-actions.html?site=HGO'), '<a class="edv-act" href="site-actions.html?site=HGO">→ act</a>');
  for (const bad of ['javascript:alert(1)', 'https://evil.example', '//evil.example', 'a b', '"x"']) assert.equal(DR.actionLink(bad), '', bad);
  const W = require('../services/dashboardWidgets');
  const doc = (href) => ({ key: 'k', title: 'T', widgets: [{ id: 'k1', type: 'kpi', metric: 'helpdesk.inbound', action_href: href, layout: { x: 0, y: 0, w: 3, h: 2 } }] });
  assert.equal(W.validateDashboard(doc('site-actions.html')).ok, true);
  assert.equal(W.validateDashboard(doc('https://evil.example')).ok, false);
});

test('registry: base only where the reader returns the denominator; resolution SLA has none', async () => {
  const MR = require('../services/metricRegistry');
  const reg = MR.createRegistry();
  assert.deepEqual(MR.baseFor({ key: 'helpdesk.closure_pct' }, { inbound: 142 }), { n: 142, label: 'tickets created' });
  assert.equal(MR.baseFor({ key: 'helpdesk.resolution_sla_pct' }, { closed: 120 }), null, 'no invented denominator');
  assert.equal(MR.baseFor({ key: 'helpdesk.closure_pct' }, { inbound: null }), null);
  const deps = { rdb: { getCalendarMonthlyHelpdesk: async () => ({ inbound: 10, closed: 8, close_pct: 80, sla_res_pct: 90, sla_reply_pct: 70 }) } };
  const r = await reg.resolve('helpdesk.closure_pct', { site: 1, window: '2026-06', deps, now: new Date('2026-07-15T00:00:00Z') });
  assert.deepEqual(r.base, { n: 10, label: 'tickets created' });
  const s = await reg.resolve('helpdesk.resolution_sla_pct', { site: 1, window: '2026-06', deps, now: new Date('2026-07-15T00:00:00Z') });
  assert.equal(s.base, null);
});

test('every page that loads dashboardRender.js loads stateBadge.js first; the switch is a default-off UI key', () => {
  const pub = path.join(__dirname, '..', 'public');
  for (const f of fs.readdirSync(pub).filter((x) => x.endsWith('.html'))) {
    const t = fs.readFileSync(path.join(pub, f), 'utf8');
    const i = t.indexOf('src="lib/dashboardRender.js"'); if (i < 0) continue;
    const j = t.indexOf('src="lib/stateBadge.js"');
    assert.ok(j >= 0 && j < i, f + ' must load lib/stateBadge.js before lib/dashboardRender.js');
  }
  const { DEFAULTS } = require('../services/reportConfig');
  assert.equal(DEFAULTS.ui_kpi_base_line, '0');
  assert.equal(require('../services/uiPolicy').uiPolicyFrom({}).kpi_base_line, '0');
});
