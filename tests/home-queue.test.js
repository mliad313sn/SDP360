'use strict';
// R2-QUEUE (REBUILD-SPEC R3) — the progressive queue "S1": pure behaviour of public/lib/homeQueue.js.
const { test } = require('node:test');
const assert = require('node:assert');
const HQ = require('../public/lib/homeQueue');

const SITES = [{ site_id: 7, code: 'HGO', name: 'Hounde' }, { site_id: 8, code: 'MGO', name: 'Mana' }];
const ok = (json) => ({ status: 200, json });
const tick = () => new Promise((r) => setImmediate(r));

function fake(routes) {
  const calls = [];
  return { calls, fetchJson: async (url) => { calls.push(url); const f = routes(url); if (f instanceof Error) throw f; return f; } };
}
function happy(url) {
  if (url.startsWith('/api/meetings/actions?site=')) {
    const code = decodeURIComponent(url.split('=')[1]);
    return ok({ rows: [
      { id: 1, meeting_id: 11, site_code: code, description: 'Fix switch ' + code, owner_it: 'ana', target_date: '2026-11-01', status: 'open' },
      { id: 2, meeting_id: 12, site_code: code, description: 'Done one', status: 'resolved' },
      { id: 3, meeting_id: 13, site_code: 'SGO', description: 'Another site', status: 'open' },   // never shown
    ] });
  }
  if (url.startsWith('/api/inspection/actions?site=')) return ok({ rows: [{ id: 5, inspection_id: 'EM-IT-1', site_code: url.slice(-3), description: 'Label rack', owner: 'bo', due_date: '2026-12-30', status: 'Open' }] });
  if (url.startsWith('/api/reports/site-actions?site=')) return ok({ groups: { report: { items: [{ title: 'Follow-up', owner: null, due_date: null, status: 'open', close: { url: 'reports.html?report=42' } }] } } });
  if (url === '/api/commitments') return ok({ commitments: [{ id: 9, site_id: 7, title: 'Mine', status: 'committed', due_date: '2026-11-20', accountable_owner: 'ana' }, { id: 10, site_id: 99, title: 'Other site', status: 'committed' }] });
  return { status: 500 };
}

test('only the person\'s own site codes are requested, and a row naming another site is dropped', async () => {
  const f = fake(happy);
  const q = HQ.createQueue({ sites: SITES, asOf: '2026-11-12', fetchJson: f.fetchJson, awaiting: undefined });
  await q.loadAll();
  const per = f.calls.filter((u) => /site=/.test(u)).map((u) => u.split('=')[1]);
  assert.deepStrictEqual([...new Set(per)].sort(), ['HGO', 'MGO']);
  const v = q.view();
  assert.ok(!v.items.some((x) => /Another site|Other site/.test(x.title)), 'foreign rows never shown');
  assert.ok(!v.items.some((x) => x.title === 'Done one'), 'terminal statuses dropped');
});

test('deep links when authorised, register fallback otherwise; late first; owner kept', async () => {
  const f = fake(happy);
  const q = HQ.createQueue({ sites: SITES, asOf: '2026-11-12', fetchJson: f.fetchJson });
  await q.loadAll();
  const v = q.view();
  assert.equal(v.items[0].overdue, true, 'late items lead');
  const m = v.items.find((x) => x.source === 'meetings');
  assert.match(m.href, /^meeting\.html\?id=11$/); assert.equal(m.deep, true); assert.equal(m.owner, 'ana');
  assert.equal(v.items.find((x) => x.source === 'report').href, 'reports.html?report=42');
  assert.equal(v.items.find((x) => x.source === 'commitments').href, 'commitments.html?id=9');
  const reg = HQ.fromReport({ groups: { report: { items: [{ title: 'x', close: { url: 'javascript:alert(1)' } }] } } }, 'HGO', '2026-11-12')[0];
  assert.equal(reg.href, 'site-actions.html?site=HGO'); assert.equal(reg.deep, false);
});

test('each source carries its own state: denied, unknown (switched off), partial, available', async () => {
  const f = fake((url) => {
    if (url.startsWith('/api/meetings/actions')) return { status: 403 };
    if (url.startsWith('/api/inspection/actions?site=HGO')) return ok({ rows: [] });
    if (url.startsWith('/api/inspection/actions')) return new Error('down');
    if (url === '/api/commitments') return { status: 404 };
    return happy(url);
  });
  const q = HQ.createQueue({ sites: SITES, asOf: '2026-11-12', fetchJson: f.fetchJson, awaiting: { commitments: { count: 0, items: [] }, handoffs: null, benefits: { count: 0, items: [] }, decisions: { count: 1, items: [{ id: 3, ref: 'D-3', title: 'Pick', due_date: '2026-11-10', overdue: true, link: 'cockpit.html?session=4' }] }, pvs: { count: 0, items: [] } } });
  await q.loadAll();
  const s = Object.fromEntries(q.view().states.map((x) => [x.source, x]));
  assert.equal(s.meetings.state, 'denied');
  assert.equal(s.inspections.state, 'partial'); assert.match(s.inspections.detail, /1 of 2 sites/);
  assert.equal(s.report.state, 'available');
  assert.equal(s.commitments.state, 'unknown'); assert.match(s.commitments.detail, /not switched on/);
  assert.equal(s.awaiting.state, 'partial', 'one "Awaiting me" part not measured → partial, never 0');
  assert.ok(q.view().items.some((x) => x.source === 'awaiting' && x.href === 'cockpit.html?session=4'));
});

test('"Awaiting me" switched off = unknown (not switched on); not measured = unknown', async () => {
  const q1 = HQ.createQueue({ sites: [], fetchJson: async () => ({ status: 200, json: {} }), awaiting: undefined });
  await q1.loadAll();
  assert.equal(q1.state.awaiting.state, 'unknown'); assert.match(q1.state.awaiting.detail, /not switched on/);
  const q2 = HQ.createQueue({ sites: [], fetchJson: async () => ({ status: 200, json: {} }), awaiting: null });
  await q2.loadAll();
  assert.equal(q2.state.awaiting.state, 'unknown'); assert.equal(q2.state.awaiting.detail, null);
  assert.equal(q2.state.meetings.state, 'unknown', 'no site → unknown, never an empty "available"'); assert.match(q2.state.meetings.detail, /no site code/);
});

test('a refresh that fails keeps the last read, labelled stale with its time', async () => {
  let fail = false;
  const f = fake((url) => (fail && url.startsWith('/api/meetings') ? { status: 500 } : happy(url)));
  const q = HQ.createQueue({ sites: SITES, asOf: '2026-11-12', fetchJson: f.fetchJson, now: () => new Date(2026, 10, 12, 9, 5) });
  await q.loadAll();
  assert.equal(q.state.meetings.state, 'available');
  const n = q.state.meetings.items.length;
  fail = true; await q.load('meetings');
  assert.equal(q.state.meetings.state, 'stale'); assert.equal(q.state.meetings.items.length, n); assert.match(q.state.meetings.detail, /09:05/);
});

test('the site list could not be read (sites = null) → per-site sources unknown; retry re-reads /api/me/work', async () => {
  const f = fake(happy);
  let reads = 0;
  const q = HQ.createQueue({ sites: null, fetchJson: f.fetchJson, asOf: '2026-11-12', reloadWork: async () => { reads++; return { sites: SITES, truncated: 0, awaiting_me: undefined }; } });
  await q.loadAll();
  assert.equal(q.state.meetings.state, 'unknown'); assert.equal(f.calls.length, 0);
  await q.load('meetings');
  assert.equal(reads, 1); assert.equal(q.state.meetings.state, 'available');
});

test('limits: 12 sites, 150 items shown, the rest counted; truncated sites stated', async () => {
  const many = Array.from({ length: 14 }, (_, i) => ({ site_id: i + 1, code: 'S' + i, name: 'S' + i }));
  const f = fake((url) => (url.startsWith('/api/meetings/actions') ? ok({ rows: Array.from({ length: 20 }, (_, k) => ({ id: k, meeting_id: k, description: 'a' + k, status: 'open' })) }) : ok({ rows: [], groups: {}, commitments: [] })));
  const q = HQ.createQueue({ sites: many, truncated: 3, fetchJson: f.fetchJson, asOf: '2026-11-12' });
  await q.loadAll();
  assert.equal(f.calls.filter((u) => u.startsWith('/api/meetings')).length, 12);
  const v = q.view();
  assert.equal(v.items.length, 150); assert.equal(v.total, 240); assert.equal(v.truncatedSites, 3);
  const html = HQ.renderHtml(v, 'en');
  assert.match(html, /150 of 240 items shown/); assert.match(html, /3 more site\(s\) not read/); assert.match(html, /up to 12 sites and 150 items/);
});

test('states are words + symbols (never colour alone); French wording; values escaped', async () => {
  const f = fake((url) => (url.startsWith('/api/meetings') ? ok({ rows: [{ id: 1, meeting_id: 2, description: '<img src=x onerror=1>', status: 'open' }] }) : { status: 403 }));
  const q = HQ.createQueue({ sites: [SITES[0]], fetchJson: f.fetchJson, asOf: '2026-11-12', awaiting: undefined });
  await q.loadAll();
  const en = HQ.renderHtml(q.view(), 'en'), fr = HQ.renderHtml(q.view(), 'fr');
  assert.match(en, /role="img" aria-label="Available"/); assert.match(en, /aria-label="Not allowed"/);
  assert.match(en, />⊘<\/span> Not allowed/);
  assert.match(fr, /Accès refusé/); assert.match(fr, /Ma file de travail/); assert.match(fr, /Réessayer/);
  assert.ok(!en.includes('<img'), 'free text is escaped');
  for (const k of Object.keys(HQ.STATES)) assert.ok(HQ.STATES[k].symbol && HQ.STATES[k].en && HQ.STATES[k].fr, k);
});

test('requests run through a small pool (never 36 at once)', async () => {
  let inFlight = 0, peak = 0;
  const many = Array.from({ length: 12 }, (_, i) => ({ site_id: i + 1, code: 'S' + i }));
  const q = HQ.createQueue({ sites: many, asOf: '2026-11-12', fetchJson: async () => { inFlight++; peak = Math.max(peak, inFlight); await tick(); inFlight--; return ok({ rows: [] }); } });
  await q.loadAll();
  assert.ok(peak <= HQ.LIMITS.parallel, 'peak ' + peak);
});
