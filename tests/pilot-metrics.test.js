'use strict';
// B-02 — pilot measurement kit, pure half + read-only guarantees.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const P = require('../services/pilotMetrics');
const cli = require('../tools/pilot/pilot-metrics');

const KEY = 'test-only-pseudonym-key-0123456789';
const NOW = Date.parse('2026-11-04T12:00:00Z');
const users = [{ id: 1, role: 'editor', site: 'Hounde' }, { id: 2, role: 'admin', site: 'Mana' }];

test('median is null on no data, never 0', () => {
  assert.equal(P.median([]), null);
  assert.equal(P.median([null, undefined, NaN]), null);
  assert.equal(P.median([3, 1, 2]), 2);
  assert.equal(P.median([1, 2, 3, 4]), 2.5);
});

test('isoWeek follows the Thursday rule; zone-less text read as UTC', () => {
  assert.equal(P.isoWeek('2026-01-01'), '2026-W01');
  assert.equal(P.isoWeek('2027-01-01'), '2026-W53');
  assert.equal(P.isoWeek('2026-11-02 08:00:00'), '2026-W45');
  assert.equal(P.isoWeek(null), null);
  assert.equal(P.hoursBetween('2026-11-02 08:00:00', '2026-11-02T10:30:00Z'), 2.5);
});

test('business events exclude sign-in, sync, api, config and page views', () => {
  assert.equal(P.isBusinessEvent('auth', 'login_success'), false);
  assert.equal(P.isBusinessEvent('dashboards', 'dashboard_viewed'), false);
  assert.equal(P.isBusinessEvent('assets', 'assets_viewed'), false);
  assert.equal(P.isBusinessEvent('sync', 'sync_failed'), false);
  assert.equal(P.isBusinessEvent('report', 'report_submitted'), true);
  assert.equal(P.isBusinessEvent('field', 'field_action_applied'), true);
});

test('pseudonym is stable, keyed, and refuses a missing or short key', () => {
  const a = P.pseudonym(1, KEY);
  assert.match(a, /^u_[0-9a-f]{12}$/);
  assert.equal(a, P.pseudonym(1, KEY));
  assert.notEqual(a, P.pseudonym(1, KEY + 'x'));
  assert.notEqual(a, P.pseudonym(2, KEY));
  assert.throws(() => P.pseudonym(1, ''), /key/);
  assert.throws(() => P.pseudonym(1, 'short'), /key/);
});

test('empty window prints "no data" for every measure, never a 0 median', () => {
  const rep = P.buildReport({ from: '2026-11-02', to: '2026-11-08', users, metrics: [], nowMs: NOW });
  const md = P.toMarkdown(rep);
  const sections = md.split('\n## ').slice(1);
  assert.equal(sections.length, P.MEASURES.length);
  for (const s of sections) assert.match(s, /\nno data\n?/, s.split('\n')[0]);
  assert.doesNotMatch(md, /\| 0 \|/);
  assert.match(P.toCsv(rep), /# no data/);
});

test('every measure carries its definition and source tables in the output header', () => {
  const rep = P.buildReport({ from: '2026-11-02', to: '2026-11-08', users, nowMs: NOW });
  const md = P.toMarkdown(rep), csv = P.toCsv(rep);
  for (const m of P.MEASURES) {
    assert.ok(m.definition.length > 40 && m.sources.length, m.key);
    assert.ok(md.includes('- Definition: ' + m.definition), m.key);
    assert.ok(md.includes('- Source tables: ' + m.sources.join(', ')), m.key);
    assert.ok(csv.split('\n').some((l) => l.startsWith('# ' + m.key + ' | ') && l.includes(m.sources[0])), m.key);
  }
  assert.match(md, /proxy, not effort/i);
});

test('medians, buckets, window, site filter and "before" counts', () => {
  const rep = P.buildReport({
    from: '2026-11-02', to: '2026-11-08', users, nowMs: NOW,
    reports: [
      { site: 'Hounde', user_id: 1, created_at: new Date('2026-11-02T08:00:00Z'), submitted_at: '2026-11-03 08:00:00' },  // 24 h
      { site: 'Hounde', user_id: 1, created_at: new Date('2026-11-02T08:00:00Z'), submitted_at: '2026-11-02 10:00:00' },  // 2 h
      { site: 'Hounde', user_id: 1, created_at: new Date('2026-10-01T08:00:00Z'), submitted_at: '2026-10-02 08:00:00' },  // outside window
    ],
    pvActions: [
      { site: 'HGO', user_id: 1, submitted_at: '2026-11-03 09:00:00', action_created_at: new Date('2026-11-03T15:00:00Z') }, // 6 h
      { site: 'HGO', user_id: 1, submitted_at: '2026-11-03 09:00:00', action_created_at: new Date('2026-11-02T09:00:00Z') }, // before
    ],
    closures: [{ source: 'inspection', site: 'HGO', user_id: 2, created_at: new Date('2026-11-01T00:00:00Z'), closed_at: '2026-11-05 00:00:00' }],
  });
  const r = rep.sections.report_created_to_submitted.rows;
  assert.deepEqual(r, [{ site: 'Hounde', persona: 'editor', week: '2026-W45', n: 2, median_h: 13, before: 0 }]);
  assert.deepEqual(rep.sections.pv_submitted_to_action.rows, [{ site: 'HGO', persona: 'editor', week: '2026-W45', n: 1, median_h: 6, before: 1 }]);
  assert.deepEqual(rep.sections.action_created_to_closed.rows, [{ site: 'HGO · inspection', persona: 'admin', week: '2026-W45', n: 1, median_h: 96, before: 0 }]);
  const only = P.buildReport({ from: '2026-11-02', to: '2026-11-08', users, siteSet: new Set(['mana']), reports: [{ site: 'Hounde', user_id: 1, created_at: '2026-11-02', submitted_at: '2026-11-03' }] });
  assert.equal(only.sections.report_created_to_submitted.rows.length, 0);
});

test('active users count distinct users; per-user lines only under a pseudonym; field conflicted is null', () => {
  const events = [{ user_id: 1, ts: '2026-11-02T08:00:00Z' }, { user_id: 1, ts: '2026-11-03T08:00:00Z' }, { user_id: 2, ts: '2026-11-03T08:00:00Z' }];
  const field = [{ user_id: 1, status: 'applied', received_at: '2026-11-02T08:00:00Z' }, { user_id: 1, status: 'rejected', received_at: '2026-11-02T09:00:00Z' }, { user_id: 1, status: 'received', received_at: '2026-11-02T09:00:00Z' }];
  const noKey = P.buildReport({ from: '2026-11-02', to: '2026-11-08', users, events, field });
  assert.deepEqual(noKey.sections.active_users.rows.map((r) => [r.site, r.n]), [['Hounde', 1], ['Mana', 1]]);
  assert.equal(noKey.sections.active_users.users, null);
  assert.match(P.toMarkdown(noKey), /PILOT_PSEUDONYM_KEY/);
  const f = noKey.sections.field_outcomes.rows[0];
  assert.deepEqual([f.applied, f.refused, f.pending, f.conflicted], [1, 1, 1, null]);
  assert.match(P.toMarkdown(noKey), /not recorded/);
  const withKey = P.buildReport({ from: '2026-11-02', to: '2026-11-08', users, events, pseudonymKey: KEY });
  const u = withKey.sections.active_users.users;
  assert.equal(u.length, 2);
  assert.ok(u.every((x) => /^u_[0-9a-f]{12}$/.test(x.pseudonym) && !('user_id' in x)));
  assert.equal(u.find((x) => x.site === 'Hounde').events, 2);
});

test('CSV cells are neutralised against formula injection', () => {
  const rep = P.buildReport({ from: '2026-11-02', to: '2026-11-08', users: [{ id: 9, role: 'editor', site: '=HYPERLINK("x")' }], events: [{ user_id: 9, ts: '2026-11-03T08:00:00Z' }] });
  assert.match(P.toCsv(rep), /active_users,"'=HYPERLINK/);
});

test('registry freshness share: unknown + stale over published metrics; no metrics → null share', () => {
  const metrics = [{ key: 'a', module: 'helpdesk', status: 'published' }, { key: 'b', module: 'helpdesk', status: 'published' },
    { key: 'c', module: 'wan', status: 'published' }, { key: 'd', module: 'meetings', status: 'published' }, { key: 'e', module: 'assets', status: 'draft' }];
  const s = P.freshnessShare(metrics, { 'zoho.requests': new Date(NOW - 3600e3).toISOString(), 'meraki.wan': null }, NOW);
  assert.equal(s.total, 4);
  assert.equal(s.unknown, 1);
  assert.equal(s.stale, 0);
  assert.equal(s.share_pct, 25);
  const stale = P.freshnessShare(metrics, { 'zoho.requests': new Date(NOW - 10 * 3600e3).toISOString() }, NOW);
  assert.equal(stale.stale, 2);
  assert.equal(P.freshnessShare([], {}, NOW).share_pct, null);
});

test('the module and the CLI contain no write statement (read-only by construction)', () => {
  for (const f of ['../services/pilotMetrics.js', '../tools/pilot/pilot-metrics.js']) {
    const src = fs.readFileSync(path.join(__dirname, f), 'utf8');
    // SQL keywords are upper-case in this code base; crypto's hmac.update() is not a statement
    assert.doesNotMatch(src, /\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE|MERGE|GRANT)\b/, f);
  }
  assert.match(fs.readFileSync(path.join(__dirname, '../tools/pilot/pilot-metrics.js'), 'utf8'), /TRANSACTION READ ONLY/);
});

test('the CLI never selects a name or an e-mail column, loads .env first and guards its entrypoint', () => {
  const src = fs.readFileSync(path.join(__dirname, '../tools/pilot/pilot-metrics.js'), 'utf8');
  const code = src.split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.doesNotMatch(code, /\b(username|full_name|email|actor\b|author_name|first_name|last_name)\b/i);
  const lines = src.split(/\r?\n/).filter((l) => /require\(/.test(l));
  assert.match(lines[0], /require\.main === module\) require\('dotenv'\)/);
  assert.match(src, /if \(require\.main === module\) \{\n  run\(\)/);
});

test('CLI argument validation and --site expansion', () => {
  assert.deepEqual(cli.validate(cli.parseArgs([])).length, 2);
  assert.deepEqual(cli.validate(cli.parseArgs(['--from=2026-11-09', '--to=2026-11-02'])), ['--from is after --to']);
  assert.deepEqual(cli.validate(cli.parseArgs(['--from=2026-11-02', '--to=2026-11-09', '--format=pdf'])), ['--format must be md, csv or both']);
  const set = cli.siteSetFor('hgo', [{ name: 'Hounde', code: 'HGO' }, { name: 'Hounde', code: 'MGO' }, { name: 'Mana', code: 'MNA' }]);
  assert.deepEqual([...set].sort(), ['hgo', 'hounde', 'mgo']);
  assert.equal(cli.siteSetFor(null, []), null);
});

test('report follow-ups: created = first report of the lineage, closed only when the newest row is closed', () => {
  const rows = [
    { grp: 'L1', status: 'open', start_date: '2026-10-26', report_created_at: new Date('2026-10-27T08:00:00Z'), status_changed_at: null, user_id: 1, site: 'Hounde' },
    { grp: 'L1', status: 'closed', start_date: '2026-11-02', report_created_at: new Date('2026-11-03T08:00:00Z'), status_changed_at: '2026-11-04 08:00:00', user_id: 2, site: 'Hounde' },
    { grp: 'L2', status: 'closed', start_date: '2026-10-26', report_created_at: new Date('2026-10-27T08:00:00Z'), status_changed_at: '2026-10-28 08:00:00', user_id: 1, site: 'Hounde' },
    { grp: 'L2', status: 'open', start_date: '2026-11-02', report_created_at: new Date('2026-11-03T08:00:00Z'), status_changed_at: null, user_id: 1, site: 'Hounde' },
  ];
  const out = cli.reportActionClosures(rows);
  assert.equal(out.length, 1);
  assert.equal(P.hoursBetween(out[0].created_at, out[0].closed_at), 192);
  assert.equal(out[0].user_id, 1);
});
