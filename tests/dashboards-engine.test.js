'use strict';
// Step 6 (lots 6.3-6.4) — definition validator, renderer, data resolver (injected readers, no database).
const test = require('node:test');
const assert = require('node:assert');
const def = require('../services/dashboards/definition');
const R = require('../public/lib/dashboardRender');
const { resolveAll, prevMonth } = require('../services/dashboards/data');
const { SYSTEM, DIRECTION } = require('../services/dashboards/seed');

// ── validator ─────────────────────────────────────────────────────────────
test('the seeded system dashboards are valid definitions', () => {
  for (const s of SYSTEM) { const v = def.validate(s); assert.deepStrictEqual(v.errors, [], s.id); }
});

test('validator refuses what a definition may not carry', () => {
  const base = { id: 'my-board', title: 'Mon tableau', audience: { roles: ['any'] }, widgets: [{ type: 'kpi', metrics: ['helpdesk.inbound'] }] };
  assert.ok(def.validate(base).ok);
  const errs = (patch) => def.validate({ ...base, ...patch }).errors.join(' | ');
  assert.match(errs({ id: 'Bad Id!' }), /id:/);
  assert.match(errs({ title: '' }), /title/);
  assert.match(errs({ audience: { roles: ['root'] } }), /unknown role/);
  assert.match(errs({ widgets: [{ type: 'sql', query: 'select 1' }] }), /unknown widget/);
  assert.match(errs({ widgets: [{ type: 'kpi', metrics: ['score.programme'] }] }), /not a served dictionary key/, 'documented-only keys refused');
  assert.match(errs({ widgets: [{ type: 'kpi', metrics: ['helpdesk.nope'] }] }), /not a served/);
  assert.match(errs({ widgets: [{ type: 'text', markdown: 'hello <script>x()</script>' }] }), /HTML is not allowed/);
  assert.match(errs({ widgets: [{ type: 'events', source: 'tickets' }] }), /incidents or decisions/);
  assert.match(errs({ widgets: [{ type: 'trend', metrics: ['helpdesk.inbound', 'helpdesk.closed', 'helpdesk.backlog', 'helpdesk.sla_overdue'] }] }), /1 to 3/);
  const ok = def.validate({ ...base, widgets: [{ type: 'trend', metrics: ['helpdesk.inbound'], span: 40, points: 999 }] }).definition;
  assert.strictEqual(ok.widgets[0].span, 6, 'an out-of-range span falls back to the default');
  assert.strictEqual(ok.widgets[0].points, 13);
});

test('audience: super_admin always, "any" for every signed-in person, otherwise one of the roles', () => {
  const d = def.validate(DIRECTION).definition;
  const has = (u, r) => u.roles.includes(r);
  assert.ok(def.audienceAllows(d, { roles: ['executive'] }, has));
  assert.ok(def.audienceAllows(d, { roles: ['super_admin'] }, has));
  assert.ok(!def.audienceAllows(d, { roles: ['viewer'] }, has));
  assert.ok(!def.audienceAllows(d, null, has));
});

// ── renderer ──────────────────────────────────────────────────────────────
test('renderer escapes every value, writes RAG states in words, prints — for not measured', () => {
  const d = { title: { fr: '<b>T</b>' }, widgets: [{ id: 'k', type: 'kpi', span: 12, title: { fr: 'Objectifs' } }] };
  const html = R.render(d, { context: { scope: 'group', month: '2026-10' }, widgets: { k: { domains: [], prev_month: '2026-09', items: [
    { key: 'a', label: { fr: 'SLA <x>' }, unit: '%', value: 86.4, prev: 89.5, delta: -3.1, rag: 'amber', policy: 'sla_pct', direction: 'higher' },
    { key: 'b', label: { fr: 'CSAT' }, unit: '%', value: null, rag: null, policy: 'sla_pct', direction: 'higher' },
  ] } } }, { lang: 'fr' });
  assert.ok(!html.includes('<b>T</b>') && html.includes('&lt;b&gt;T&lt;/b&gt;'));
  assert.ok(html.includes('SLA &lt;x&gt;'));
  assert.ok(html.includes('86,4 %'));
  assert.ok(html.includes('À surveiller'), 'amber written in words');
  assert.ok(html.includes('Non mesuré'));
  assert.ok(html.includes('▼ 3,1'), 'a drop on a higher-is-better figure');
  assert.match(html, /db-down/);
  assert.ok(/<div class="db-big">—<\/div>/.test(html), 'null renders —, never 0');
});

test('markdown: headings, lists, bold, internal links only, no HTML', () => {
  const h = R.markdown('# Titre\n- **un** [lien](direction.html)\n- [x](javascript:alert(1))\n<img src=x onerror=1>');
  assert.ok(h.includes('<h3>Titre</h3>') && h.includes('<strong>un</strong>') && h.includes('<a href="direction.html">lien</a>'));
  assert.ok(!/javascript:/i.test(h.replace('javascript:alert(1)', '')) || !h.includes('href="javascript'), 'no javascript: href');
  assert.ok(!h.includes('href="javascript'));
  assert.ok(!h.includes('<img'), 'raw HTML is escaped');
});

test('every widget type has a renderer and an error state', () => {
  for (const t of Object.keys(def.WIDGETS)) assert.ok(R.WIDGET_TYPES.includes(t), t);
  const html = R.render({ title: { fr: 'x' }, widgets: [{ id: 'e', type: 'bars', span: 6, title: { fr: 'B' } }] },
    { context: {}, widgets: { e: { error: 'boom <i>' } } }, { lang: 'en' });
  assert.match(html, /role="alert"/);
  assert.ok(html.includes('boom &lt;i&gt;'));
});

// ── data resolver ─────────────────────────────────────────────────────────
const sites = [{ site_id: 1, code: 'AAA', name: 'Alpha' }, { site_id: 2, code: 'BBB', name: 'Beta' }];
const metrics = {
  getCalendarMonthlyHelpdesk: async (id, y, m) => (m === 10 ? { inbound: id * 10, closed: 10, sla_res_ok: id === 1 ? 9 : 5, sla_res_pct: id === 1 ? 90 : 50, sla_reply_ok: 1, sla_reply_total: 1 }
    : { inbound: 5, closed: 10, sla_res_ok: 10, sla_res_pct: 100, sla_reply_ok: 1, sla_reply_total: 1 }),
  getSiteHelpdeskWindow: async () => ({ created: 4, resolved: 3, sla_res_ok: 3, sla_res_pct: 100, major_incidents: 0, backlog: 1, sla_overdue: 0 }),
  getSiteChangesWindow: async () => ({ total: 1, successful: 1, executed: 1 }),
  getSiteMonthlyMeetingSummary: async () => ({ kpis: {} }),
  getInspectionAggregate: async () => ({ counts: { total: 0 }, findingStatus: [] }),
  getEffortLeaderboard: async () => [], effortForSite: () => null,
  getSiteGroups: async () => ['G'], getSurveyKpisDB: async () => ({ rows1: [] }),
  meetingsInsights: async () => ({ site_leaderboard: [] }), getWanSnapshots: async () => [],
  getScoreboard: async () => ({ rows: [{ code: 'AAA', score: 80, applicable: true }, { code: 'BBB', score: 40, applicable: true }] }),
};
const T = { activities: [{ pillar: 'P1-Network' }, { pillar: 'P2-People' }], activeSites: ['MGO'], pillarWeights: { 'P1-Network': 60, 'P2-People': 40 } };
const readers = {
  listSites: async () => [{ id: 1, name: 'Alpha', zoho_group: 'GA' }, { id: 2, name: 'Beta', zoho_group: 'GB' }],
  getActiveMajorIncidentsForSite: async (groups) => (groups.includes('GA') ? [{ subject: 'Fibre cut', tech_group: 'GA', request_status: 'Open', created_time: '2026-10-21T20:00:00Z', udf_json: '{"UDF:Root Cause Analysis":"done"}', technician: 'SECRET PERSON' }] : []),
  getPendingCabDecisions: async () => [{ subject: 'Mail migration', display_id: 'CH-1', risk: 'High', emergency: 0, group_name: 'GB', requested_at: '2026-10-12T08:00:00Z' }],
  meetingsDb: {
    listIssues: async () => [{ title: 'Core switch', site_code: 'AAA', status: 'open', council_theme: 'network', meeting_date: '2026-10-01' }, { title: 'Done', site_code: 'AAA', status: 'resolved' }],
    listActions: async () => [{ site_code: 'aaa', description: 'Patch', target_date: '2026-08-01' }],
  },
  inspectionDb: { listActions: async () => [{ site_code: 'BBB', description: 'Label racks', due_date: '2026-10-15' }] },
  trackerDb: { loadTracker: async () => T, siteToCode: () => 'MGO' },
  trackerScore: { ps2: (D, s, p, y, m) => (p === 'P1-Network' ? (m === 10 ? 0.7 : 0.6) : 0.5), fleetStats: (D, s, y, m) => ({ avg: m === 10 ? 0.62 : 0.6, attainment: 0.5 }) },
};
const ctx = (scope) => ({ scope, site: scope === 'site' ? sites[0] : null, sites, month: '2026-10', asOf: '2026-10-22', targets: { wan: 98 } });
const W = (widgets) => ({ widgets });

test('resolver: every widget type, group scope', async () => {
  const d = def.validate({ id: 'all-types', title: 'x', audience: { roles: ['any'] }, widgets: [
    { id: 'k', type: 'kpi', metrics: ['helpdesk.sla_res_pct'] },
    { id: 't', type: 'trend', metrics: ['helpdesk.inbound'], points: 2 },
    { id: 'b', type: 'bars', metrics: ['score.scoreboard'] },
    { id: 'tb', type: 'table', metrics: ['helpdesk.sla_res_pct'] },
    { id: 'h', type: 'heatmap', metrics: ['helpdesk.inbound'], points: 2 },
    { id: 'r', type: 'rag-grid', metrics: ['helpdesk.sla_res_pct'] },
    { id: 'tr', type: 'tracker' }, { id: 'x', type: 'text', markdown: 'Note' }, { id: 'a', type: 'actions' },
    { id: 'i', type: 'events', source: 'incidents' }, { id: 'd', type: 'events', source: 'decisions' },
  ] }).definition;
  const out = (await resolveAll(d, ctx('group'), { metrics, readers })).widgets;
  for (const w of d.widgets) assert.ok(!out[w.id].error, `${w.id}: ${out[w.id].error}`);
  assert.strictEqual(out.k.items[0].value, 70, 'group SLA = Σ on-time ÷ Σ closed (14/20)');
  assert.strictEqual(out.k.items[0].prev, 100);
  assert.strictEqual(out.k.items[0].delta, -30);
  assert.strictEqual(out.k.items[0].rag, 'red');
  assert.deepStrictEqual(out.k.items[0].window, { from: '2026-10-01', to: '2026-10-31' });
  assert.strictEqual(out.t.series[0].points.length, 2);
  assert.deepStrictEqual(out.b.rows.map(r => r.code), ['AAA', 'BBB'], 'bars sorted by value');
  assert.strictEqual(out.tb.total[0].value, 70, 'the table carries the group row');
  assert.strictEqual(out.h.rows.length, 2);
  assert.strictEqual(out.tr.overall, 62); assert.strictEqual(out.tr.overall_delta, 2);
  assert.deepStrictEqual(out.tr.pillars.map(p => [p.name, p.pct, p.delta, p.rag]), [['Network', 70, 10, 'green'], ['People', 50, 0, 'red']]);
  assert.strictEqual(out.a.total, 2); assert.strictEqual(out.a.over30, 1);
  assert.strictEqual(out.i.open, 1);
  assert.strictEqual(out.i.items[0].rca_done, true);
  assert.ok(!JSON.stringify(out.i).includes('SECRET PERSON'), 'no personal field leaves the resolver');
  assert.deepStrictEqual(out.d.items.map(i => i.kind).sort(), ['cab', 'council', 'late']);
  assert.strictEqual(out.d.council, 1, 'a resolved escalation is not pending');
});

test('resolver: site scope sees its own site only', async () => {
  const d = def.validate({ id: 'site-board', title: 'x', audience: { roles: ['any'], site_scope: 'own' }, widgets: [
    { id: 'tb', type: 'table', metrics: ['helpdesk.sla_res_pct'] }, { id: 'd', type: 'events', source: 'decisions' }, { id: 'i', type: 'events', source: 'incidents' },
  ] }).definition;
  const out = (await resolveAll(d, ctx('site'), { metrics, readers })).widgets;
  assert.deepStrictEqual(out.tb.rows.map(r => r.code), ['AAA']);
  assert.strictEqual(out.tb.total, null, 'no group row for a site viewer');
  assert.ok(out.d.items.every(i => i.site === 'Alpha'), 'the CAB change of Beta is not shown to Alpha');
  assert.strictEqual(out.i.open, 1);
});

test('resolver: one failing widget does not take the others down', async () => {
  const d = def.validate({ id: 'mixed', title: 'x', audience: { roles: ['any'] }, widgets: [{ id: 'tr', type: 'tracker' }, { id: 'x', type: 'text', markdown: 'ok' }] }).definition;
  const broken = { ...readers, trackerDb: { loadTracker: async () => { throw new Error('db down'); } } };
  const out = (await resolveAll(d, ctx('group'), { metrics, readers: broken })).widgets;
  assert.match(out.tr.error, /db down/);
  assert.strictEqual(out.x.markdown, 'ok');
});

test('prevMonth crosses the year', () => {
  assert.strictEqual(prevMonth('2026-01'), '2025-12');
  assert.strictEqual(prevMonth('2026-10'), '2026-09');
});
