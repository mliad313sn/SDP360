'use strict';
// Step 9 — engagement rules and their state machine, the AI number guard, the deterministic analysis, signed links,
// the OData filter, the publication schedule, the report outputs. SQLite in a temporary folder.
process.env.REPORTS_BACKEND = 'sqlite';
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_p.join(_os.tmpdir(), 'engagement-'));
const test = require('node:test');
const assert = require('node:assert');
const rules = require('../services/engagement/rules');
const ai = require('../services/reportgen/ai');
const { analyse } = require('../services/reportgen/analysis');
const tdef = require('../services/reportgen/definition');
const render = require('../services/reportgen/render');
const signed = require('../services/signedLink');
const odata = require('../services/publication/odata');
const runner = require('../services/publication/runner');

const served = new Set(require('../services/metrics/registry').list().filter(m => m.serve).map(m => m.key));

test('alert rules: the initial catalogue is valid, disabled, and has at least 10 rules', () => {
  assert.ok(rules.CATALOGUE.length >= 10);
  for (const r of rules.CATALOGUE) {
    const v = rules.validate(r, { servedMetrics: served });
    assert.deepStrictEqual(v.errors, [], r.id);
    assert.equal(v.rule.enabled, false, r.id);
  }
});

test('alert rules: validation, breach (null is never a breach), message', () => {
  const errs = (x) => rules.validate(x, { servedMetrics: served, siteCodes: new Set(['HGO']) }).errors.join(' | ');
  assert.match(errs({ id: 'x', title: 't', kind: 'sql' }), /kind/);
  assert.match(errs({ id: 'ok', title: 't', kind: 'metric', config: { metric: 'helpdesk.nope', threshold: 1 } }), /not a served/);
  assert.match(errs({ id: 'ok', title: 't', kind: 'metric', config: { metric: 'helpdesk.sla_res_pct' } }), /threshold/);
  assert.match(errs({ id: 'ok', title: 't', kind: 'metric', config: { metric: 'helpdesk.sla_res_pct', threshold: 85, scope: 'ZZZ' } }), /not a site code/);
  assert.match(errs({ id: 'ok', title: 't', kind: 'major_incident', channels: ['teams'] }), /channel_id/);
  const r = rules.validate({ id: 'sla', title: 'SLA', kind: 'metric', config: { metric: 'helpdesk.sla_res_pct', op: '<', threshold: 85 } }).rule;
  assert.equal(rules.breaches(r, 84.9), true); assert.equal(rules.breaches(r, 85), false); assert.equal(rules.breaches(r, null), false);
  const old = rules.validate({ id: 'old', title: 'Old', kind: 'tickets_older', config: { days: 45, threshold: 3 } }).rule;
  assert.equal(old.config.days, 45); assert.equal(rules.breaches(old, 3), true); assert.equal(rules.breaches(old, 2), false);
  assert.match(rules.message(old, 4), /4 ticket\(s\) ouvert\(s\) depuis plus de 45 jours/);
});

test('engine: persistence, one fire per episode, cooldown, recovery notice', async () => {
  const store = require('../services/engagement/store');
  const engine = require('../services/engagement/engine');
  const users = [{ username: 'boss', role: 'executive', roles: [], active: 1, email: 'b@x.org' }, { username: 'tech', role: 'editor', roles: [], active: 1 }];
  const deps = { rdb: { listUsers: async () => users, userHasRole: (u, r) => u.role === r || (u.roles || []).includes(r) }, syncStates: async () => [] };
  // a sync_health rule measures the freshness of the sync jobs: no state at all = every source "down".
  const r = rules.validate({ id: 'sync', title: 'Sync', kind: 'sync_health', persistence: 2, cooldown_hours: 24, enabled: true, recipients: [{ type: 'role', value: 'executive' }] }).rule;
  await store.saveRule(r, 'test');
  const rule = await store.getRule('sync');
  const t0 = new Date('2026-10-23T08:00:00Z');
  let x = await engine.evaluateRule(rule, deps, t0);
  assert.equal(x.breach, true); assert.equal(x.breaches, 1); assert.ok(!x.fired, 'persistence 2: not yet');
  x = await engine.evaluateRule(rule, deps, new Date(t0.getTime() + 1800000));
  assert.ok(x.fired, 'fires at the second breach'); assert.equal(x.delivery.inapp, 1, 'the executive only');
  x = await engine.evaluateRule(rule, deps, new Date(t0.getTime() + 3600000));
  assert.ok(!x.fired, 'still the same episode');
  const n = await store.listNotifications('boss');
  assert.equal(n.length, 1); assert.match(n[0].title, /Alerte — Sync/);
  deps.syncStates = async () => Object.values(require('../services/metrics/freshness').DOMAINS).filter(d => d.job).map(d => ({ job_key: d.job, last_ok_at: new Date().toISOString() }));
  x = await engine.evaluateRule(rule, deps, new Date(t0.getTime() + 5400000));
  assert.ok(x.resolved, 'back to normal');
  assert.equal((await store.listNotifications('boss')).length, 2);
  assert.ok((await store.getFire(x.resolved)).resolved_at);
});

test('AI guard: every number must exist in the facts; month and year allowed', () => {
  const facts = [{ label: 'SLA', value: 88.4, prev: 90, delta: -1.6, unit: '%' }, { label: 'Incidents', value: 2, unit: '' }];
  assert.deepStrictEqual(ai.check('Le SLA est à 88,4 % (90 % le mois dernier, en baisse de 1,6 point) ; 2 incidents en octobre 2026, mois 10.', facts, { month: '2026-10' }), { accepted: true, unknown: [] });
  const bad = ai.check('Le SLA est à 88,4 %, soit 12 % de plus que la cible de 76 %.', facts, { month: '2026-10' });
  assert.equal(bad.accepted, false); assert.deepStrictEqual(bad.unknown.sort(), ['12', '76']);
  const req = ai.buildRequest(facts, { lang: 'fr', tone: 'direction', month: '2026-10' });
  assert.match(req.system, /N’utilise QUE les chiffres/); assert.ok(JSON.parse(req.messages[0].content).facts.length === 2);
});

test('AI draft: a disabled provider and a failing model fall back, never throw', async () => {
  assert.ok((await ai.draft([], {}, { disabled: true })).skipped);
  assert.ok((await ai.draft([], {}, { call: async () => { throw new Error('timeout'); } })).skipped);
  const ok = await ai.draft([{ value: 5 }], {}, { call: async () => '5 tickets.', provider: 'local' });
  assert.equal(ok.accepted, true);
});

const PACK = tdef.validate(require('../services/reportgen/seed').PACK).definition;
const DATA = { widgets: {
  w1: { items: [{ key: 'helpdesk.sla_res_pct', label: { fr: 'SLA de résolution' }, unit: '%', value: 88.4, prev: 90, delta: -1.6, rag: 'amber' }, { key: 'helpdesk.csat_pct', label: { fr: 'Satisfaction' }, unit: '%', value: 91, prev: 90, delta: 1, rag: 'green' }] },
  w2: { series: [{ key: 'helpdesk.inbound', label: { fr: 'Tickets entrants' }, unit: '', points: [{ label: 'm1', value: 300 }, { label: 'm2', value: 320 }] }] },
  w3: { series: [] }, w4: { open: 1, items: [{ title: 'Coupure fibre', site: 'Houndé' }] }, w5: { pending: 0, council: 0, cab: 0, items: [] },
  w6: { columns: [{ key: 'x', label: { fr: 'Score' }, unit: '' }], rows: [{ name: 'Alpha', cells: [{ value: 70 }] }], total: [{ value: 75, rag: 'green' }] },
  w7: { overall: 69, overall_delta: 2, pillars: [] } } };

test('deterministic analysis: direction tone says what is off target; the facts are the only numbers', () => {
  const a = analyse(PACK, DATA, { lang: 'fr', tone: 'direction' });
  assert.deepStrictEqual(a.commentary.c2, ['1 indicateur(s) sur 2 dans l’objectif.', 'SLA de résolution : 88,4 % (à surveiller), en baisse de 1,6 point(s) par rapport au mois précédent.']);
  assert.ok(a.commentary.c9.some(s => /1 incident\(s\) majeur\(s\)/.test(s)));
  assert.equal(a.sectionFacts.c2.length, 2);
  const all = a.commentary.c2.concat(a.commentary.c9).join(' ');
  assert.equal(ai.check(all, a.facts, { month: '2026-10' }).accepted, true, 'the deterministic text passes its own guard');
});

test('report outputs: HTML (escaped, status), CSV (every figure), PPTX', async () => {
  const html = render.html(PACK, { month: '2026-10', status: 'draft', created_at: '2026-11-02T07:00:00.000Z', scope_label: 'Ensemble du groupe' }, DATA, { c2: 'Analyse <script>x</script>', c9: 'Fin.' });
  assert.ok(html.includes('Pack exécutif mensuel') && html.includes('Brouillon — en attente de relecture'));
  assert.ok(!/<script/i.test(html), 'no script'); assert.ok(html.includes('Analyse &lt;script&gt;'));
  const csv = render.csv(PACK, DATA);
  assert.ok(csv.includes('SLA de résolution;;88.4;90;%;amber'));
  assert.ok(csv.includes('Tickets entrants;m2;320'));
  const pptx = await render.pptx(PACK, { month: '2026-10', status: 'draft', scope_label: 'Groupe' }, DATA, { c2: 'Une phrase.', c9: '' });
  assert.ok(Buffer.isBuffer(pptx) && pptx.length > 20000);
});

test('signed links: sign, verify, expiry, tampering, wrong kind, sharing off without a key', () => {
  const env = { SDP_LINK_KEY: 'a-test-link-key-of-32-characters!!' };
  const now = Date.parse('2026-10-23T00:00:00Z');
  const l = signed.sign({ kind: 'share', id: 'RUN-1', days: 90 }, env, now);
  assert.equal(l.days, 30, 'a share link lasts 30 days at most');
  assert.deepStrictEqual(signed.verify(l.token, 'share', env, now + 86400000).id, 'RUN-1');
  assert.equal(signed.verify(l.token, 'share', env, now + 31 * 86400000), null, 'expired');
  assert.equal(signed.verify(l.token, 'embed', env, now), null, 'wrong kind');
  assert.equal(signed.verify(l.token.slice(0, -2) + 'xx', 'share', env, now), null, 'tampered');
  assert.equal(signed.verify(l.token, 'share', { SDP_LINK_KEY: 'another-key-of-thirty-two-chars!!!' }, now), null, 'another key');
  assert.throws(() => signed.sign({ kind: 'share', id: 'x' }, {}), /Sharing is off/);
});

test('OData $filter: supported clauses only', () => {
  assert.deepStrictEqual(odata.parseFilter("MetricKey eq 'helpdesk.sla_res_pct' and Scope eq 'group' and Month ge '2026-01' and Month le '2026-06'"),
    { key: 'helpdesk.sla_res_pct', scope: 'GROUP', from: '2026-01', to: '2026-06' });
  assert.throws(() => odata.parseFilter("Value gt 3"), /unsupported/);
  assert.throws(() => odata.parseFilter("MetricKey eq 'x' or Scope eq 'y'"), /unsupported/);
  assert.match(odata.metadata(), /EntitySet Name="MetricValues"/);
});

test('publication schedule: last slot and due logic (UTC)', () => {
  const now = new Date('2026-10-23T09:30:00Z');   // a Friday
  assert.equal(runner.lastSlot({ freq: 'daily', hour: 7 }, now).toISOString(), '2026-10-23T07:00:00.000Z');
  assert.equal(runner.lastSlot({ freq: 'daily', hour: 10 }, now).toISOString(), '2026-10-22T10:00:00.000Z');
  assert.equal(runner.lastSlot({ freq: 'weekly', weekday: 1, hour: 7 }, now).toISOString(), '2026-10-19T07:00:00.000Z');
  assert.equal(runner.lastSlot({ freq: 'monthly', day: 2, hour: 7 }, now).toISOString(), '2026-10-02T07:00:00.000Z');
  assert.equal(runner.lastSlot({ freq: 'monthly', day: 28, hour: 7 }, now).toISOString(), '2026-09-28T07:00:00.000Z');
  const p = { enabled: true, schedule: { freq: 'daily', hour: 7 }, last_run_at: '2026-10-23T07:05:00.000Z' };
  assert.equal(runner.isDue(p, now), false);
  assert.equal(runner.isDue({ ...p, last_run_at: '2026-10-22T07:05:00.000Z' }, now), true);
  assert.equal(runner.isDue({ ...p, enabled: false, last_run_at: null }, now), false);
});

test('publication execution: Teams card and webhook payload from the snapshot, e-mail needs a mailer', async () => {
  const sent = [];
  const deps = { snapshotRead: async (q) => [{ metric_key: q.key, scope: 'GROUP', month: '2026-10', value: 88.4, unit: '%', rag: 'amber' }], metricsLabel: () => 'SLA de résolution',
    post: async (id, payload) => { sent.push({ id, payload }); return { ok: true }; }, mailer: null, latestApprovedHtml: async () => null };
  const now = new Date('2026-10-23T09:00:00Z');
  const base = { id: 'P1', title: 'Indicateurs du mois', channel_id: 'CH-1', what: { metrics: ['helpdesk.sla_res_pct'], scope: 'GROUP' }, recipients: [] };
  assert.deepStrictEqual(await runner.execute({ ...base, kind: 'teams' }, deps, now), { ok: true });
  assert.match(JSON.stringify(sent[0].payload), /SLA de résolution : 88.4 % \(à surveiller\)/);
  await runner.execute({ ...base, kind: 'webhook' }, deps, now);
  assert.equal(sent[1].payload.figures[0].value, 88.4);
  assert.deepStrictEqual(await runner.execute({ ...base, kind: 'email', what: { ...base.what, template_id: 't' } }, deps, now), { ok: false, error: 'e-mail is not configured' });
  const v = runner.validate({ title: 'x', kind: 'email', recipients: 'not-an-address', what: {} });
  assert.ok(v.errors.some(e => /invalid address/.test(e)) && v.errors.some(e => /template_id/.test(e)));
});
