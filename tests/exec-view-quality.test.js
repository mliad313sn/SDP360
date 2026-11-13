'use strict';
// D3 (P10) — Exec View quality: (1) the AI provider defaults to OFF everywhere it is read; (2) small-cell suppression on
// the public Exec View (report_config exec_view_min_cell, '0' = today) — off = byte-identical payload, on = a site with
// fewer than N active major incidents cannot be re-identified (no name, no code, no per-site count, no free text).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { buildExecSummary } = require('../services/execSummary');
const { DEFAULTS } = require('../services/reportConfig');

const ROOT = path.join(__dirname, '..');

test('AI_PROVIDER defaults to off wherever the code reads it (no AI call on production data by default)', () => {
  const files = ['server.js', ...fs.readdirSync(path.join(ROOT, 'services')).map((f) => 'services/' + f), ...fs.readdirSync(path.join(ROOT, 'routes')).map((f) => 'routes/' + f)].filter((f) => f.endsWith('.js'));
  let reads = 0;
  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const m of src.matchAll(/process\.env\.AI_PROVIDER\s*\|\|\s*'([^']*)'/g)) { reads++; assert.strictEqual(m[1], 'off', `${f}: AI_PROVIDER default is '${m[1]}'`); }
    assert.ok(!/process\.env\.AI_PROVIDER\s*\?\?/.test(src), `${f}: AI_PROVIDER read without the off default`);
  }
  assert.ok(reads >= 1, 'the AI provider is read somewhere');
  assert.match(fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8'), /const AI_DISABLED = AI_PROVIDER === 'off'/);
  delete process.env.AI_PROVIDER;
  assert.strictEqual((process.env.AI_PROVIDER || 'off').toLowerCase(), 'off');
});

const base = () => ({
  period: '2026-11', reportMonth: '2026-10', dataAsOf: '2026-11-13T05:00:00Z',
  helpdesk: { requests_resolved: { value: 10 }, sla_compliance: {}, avg_resolution_h: {}, csat: {}, change_success: {} },
  spark: {}, activeMajorIncidents: 4,
  siteRows: [
    { site: 'HOUNDE', code: 'HOUNDE', name: 'HOUNDE', open_incidents: 3, has_active_mi: true, overdue_open: 0 },
    { site: 'Ity', code: 'Ity', name: 'Ity', open_incidents: 1, has_active_mi: true, overdue_open: 0 },
  ],
  majorIncidents: [
    { title: 'Fibre cut on HOUNDE ring A', site: 'HOUNDE', status: 'In progress', impact: 'Enterprise', root_cause: 'cut', corrective_action: 'splice', downtime_h: '4' },
    { title: 'HOUNDE core switch', site: 'HOUNDE', status: 'In progress', impact: 'Enterprise', root_cause: null, corrective_action: null, downtime_h: null },
    { title: 'HOUNDE PABX', site: 'HOUNDE', status: 'In progress', impact: 'Enterprise', root_cause: null, corrective_action: null, downtime_h: null },
    { title: 'Ity mill network down at the Ity plant', site: 'Ity', status: 'In progress', impact: 'Multiple departments', root_cause: 'Ity UPS', corrective_action: 'replace Ity UPS', downtime_h: '2' },
  ],
  upcomingMaintenance: [], strategic: { overall_pct: 50, pillars: [] }, editorial: { highlights: [], focus: [] },
});

test('switch default is off and off = exactly today\'s payload', () => {
  assert.strictEqual(DEFAULTS.exec_view_min_cell, '0');
  const today = buildExecSummary(base());
  const off = buildExecSummary({ ...base(), minCell: '0' });
  assert.deepStrictEqual(off, today);
  assert.ok(!('suppression' in today));
  assert.deepStrictEqual(today.sites_attention.map((s) => s.name), ['HOUNDE', 'Ity'], 'today the page names sites (Exec View v1 design)');
});

test('on: a site below N is not named anywhere in the public payload and cannot be re-identified', () => {
  const out = buildExecSummary({ ...base(), minCell: '2' });
  assert.deepStrictEqual(out.suppression, { min_cell: 2 });
  assert.deepStrictEqual(out.sites_attention.map((s) => s.name), ['HOUNDE', 'Other sites']);
  const other = out.sites_attention.find((s) => s.suppressed);
  assert.strictEqual(other.code, null);
  assert.strictEqual(other.open_incidents, null, 'no per-site count for a suppressed line');
  const json = JSON.stringify(out);
  assert.ok(!/ity/i.test(json), 'the suppressed site name appears nowhere (titles / RCA / CA / codes included)');
  const sup = out.major_incidents.filter((m) => m.suppressed);
  assert.strictEqual(sup.length, 1);
  assert.deepStrictEqual([sup[0].site, sup[0].title, sup[0].root_cause, sup[0].corrective_action], [null, 'Major incident', null, null]);
  assert.strictEqual(out.status.active_major_incidents, 4, 'fleet total kept (it names no site)');
  assert.ok(out.major_incidents.some((m) => m.site === 'HOUNDE'), 'a site at or above N stays named');
});

test('on with N above every site: nothing is named, one unnamed line remains', () => {
  const out = buildExecSummary({ ...base(), minCell: 10 });
  assert.deepStrictEqual(out.sites_attention, [{ code: null, name: 'Other sites', status: 'major', open_incidents: null, suppressed: true }]);
  assert.ok(!/hounde|ity/i.test(JSON.stringify(out.major_incidents)));
  assert.ok(!/hounde|ity/i.test(JSON.stringify(out.sites_attention)));
});
