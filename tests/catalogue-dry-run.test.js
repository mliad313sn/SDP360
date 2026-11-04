'use strict';
// B-07 — D-13 decision pack. The dry run must resolve recipients exactly as the real senders do (confirmed-only),
// say plainly that sync_alert_enabled=1 reaches nobody while no recipient/Teams URL is set, never print a secret,
// cover every catalogue id, and read the database without changing it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const C = require('../services/reportCatalogue');
const { DEFAULTS } = require('../services/reportConfig');
const { decideHygieneSend } = require('../tools/reports/send-hygiene');
const { decideAssetGroupSend } = require('../tools/reports/send-asset-group');
const { recipientsFor } = require('../tools/reports/send-asset-reminders');
const cli = require('../tools/reports/catalogue-dry-run');

const cfgOf = (over) => C.effectiveConfig(DEFAULTS, Object.entries(over || {}).map(([key, value]) => ({ key, value })));
const ctxOf = (over, extra) => ({ cfg: cfgOf(over), defaults: DEFAULTS, directory: [], digestUsers: [], alertRules: [], history: {}, days: 30, now: new Date('2026-11-04T00:00:00Z'), ...(extra || {}) });
const item = (d, id) => [...d.reports, ...d.rules, ...d.others].find((x) => x.id === id);

const DIR = [
  { site_code: 'HGO', active: 1, coordinator_email: 'hgo.coord@example.com', coordinator_email_confirmed: 1, cc_emails: 'gm@example.com', asset_manager_email: 'hgo.am@example.com', asset_manager_email_confirmed: 1 },
  { site_code: 'MGO', active: 1, coordinator_email: 'mgo.coord@example.com', coordinator_email_confirmed: 0, asset_manager_email: '', asset_manager_email_confirmed: 0 },
  { site_code: 'SGO', active: 1, coordinator_email: 'sgo.coord@example.com', coordinator_email_confirmed: 1, asset_manager_email: 'sgo.am@example.com', asset_manager_email_confirmed: 0 },
  { site_code: 'OLD', active: 0, coordinator_email: 'old@example.com', coordinator_email_confirmed: 1 },
  { site_code: 'KGO', active: 1, coordinator_email: '', coordinator_email_confirmed: 0 },
];

test('shipped defaults: sync alerts (R11/A08) are armed but reach nobody, and the pack says so', () => {
  const d = C.buildDryRun(ctxOf());
  for (const id of ['R11', 'A08']) {
    const x = item(d, id);
    assert.equal(x.armed, true, id); assert.deepEqual(x.recipients, [], id);
    assert.match(x.blockers.join(' '), /sync_alert_enabled`=1 while `sync_alert_recipients` and `sync_alert_teams_url` are empty/);
  }
  const md = C.dryRunMarkdown(d);
  assert.match(md, /\*\*R11 is armed but reaches nobody\*\*/);
  assert.match(md, /\*\*A08 is armed but reaches nobody\*\*/);
  assert.match(md, /SMTP \(`smtp_host`\): \*\*NOT configured/);
  // the switches the catalogue says ship off are off in the pack too
  for (const id of ['R04', 'R12', 'A01', 'A02', 'A06', 'A07', 'A14', 'scoreboard', 'asset_group', 'asset_reminder', 'asset_new_alert']) assert.equal(item(d, id).armed, false, id);
});

test('sync alert recipients follow server.js getAlertConfig (split /[,;\\s]+/, off only at "0", Teams counts)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.ok(src.includes("cfg.sync_alert_enabled === '0'") && src.includes("String(cfg.sync_alert_recipients || '').split(/[,;\\s]+/)"), 'server.js rule unchanged — update evaluateDelivery if it moves');
  let x = item(C.buildDryRun(ctxOf({ sync_alert_recipients: 'a@example.com; b@example.com c@example.com' })), 'R11');
  assert.deepEqual(x.recipients.map((r) => r.to), ['a@example.com', 'b@example.com', 'c@example.com']);
  x = item(C.buildDryRun(ctxOf({ sync_alert_teams_url: 'https://hook.example/secret-token-xyz' })), 'A08');
  assert.equal(x.recipients.length, 1); assert.match(x.recipients[0].to, /Teams channel/);
  x = item(C.buildDryRun(ctxOf({ sync_alert_enabled: '0', sync_alert_recipients: 'a@example.com' })), 'R11');
  assert.equal(x.armed, false);
});

test('group lists match decideHygieneSend / decideAssetGroupSend', () => {
  for (const [over, decide, id, arm, list] of [
    [{}, decideHygieneSend, 'R12', 'hygiene_send_enabled', 'hygiene_recipients'],
    [{}, decideAssetGroupSend, 'asset_group', 'asset_group_send_enabled', 'asset_group_recipients'],
  ]) {
    for (const v of [{}, { [arm]: '1' }, { [arm]: '1', [list]: ' x@example.com , y@example.com,' }, { [list]: 'x@example.com' }]) {
      const cfg = cfgOf({ ...over, ...v });
      const real = decide(cfg);
      const x = item(C.buildDryRun(ctxOf({ ...over, ...v })), id);
      assert.equal(x.armed && x.recipients.length > 0, real.send, `${id} ${JSON.stringify(v)}`);
      if (real.send) assert.deepEqual(x.recipients.map((r) => r.to), real.recipients);
    }
  }
});

test('directory recipients are confirmed-only, inactive sites skipped, asset reminders match recipientsFor', () => {
  const d = C.buildDryRun(ctxOf({ weekly_report_send_enabled: '1', asset_reminder_send_enabled: '1' }, { directory: DIR }));
  const wk = item(d, 'A06');
  assert.deepEqual(wk.recipients.map((r) => [r.site, r.to, r.cc]), [['HGO', 'hgo.coord@example.com', ['gm@example.com']], ['SGO', 'sgo.coord@example.com', []]]);
  assert.deepEqual(wk.skipped, [{ site: 'MGO', reason: 'address on file but NOT confirmed' }, { site: 'OLD', reason: 'inactive site' }, { site: 'KGO', reason: 'no address on file' }]);
  const am = item(d, 'asset_reminder');
  for (const r of am.recipients) assert.deepEqual({ to: r.to, cc: r.cc }, recipientsFor(DIR, r.site));
  assert.deepEqual(am.recipients.map((r) => r.site), ['HGO', 'SGO']);
  // coordinator monthly: no arm flag — counted as armed, flagged in "read this first"
  const md = C.dryRunMarkdown(d);
  assert.equal(item(d, 'coordinator').armed, true);
  assert.match(md, /coordinator monthly report has no arm flag\*\*: 2 site\(s\)/);
  // never_send_unconfirmed=0 widens the list, and the pack says so
  const loose = item(C.buildDryRun(ctxOf({ never_send_unconfirmed: '0', weekly_report_send_enabled: '1' }, { directory: DIR })), 'A06');
  assert.ok(loose.recipients.some((r) => r.site === 'MGO'));
  assert.match(loose.blockers.join(' '), /UNCONFIRMED addresses would also be used/);
});

test('every catalogue id is in the pack; delivery switches are real config keys; secrets never printed', () => {
  const secret = 'https://hook.example/very-secret-token-123';
  const d = C.buildDryRun(ctxOf({ sync_alert_teams_url: secret, engagement_teams_url: secret, engagement_webhook_url: secret, publish_webhook_url: secret, teams_sla_channels: `[{"group":"G","url":"${secret}"}]` },
    { digestUsers: [{ digest: 'daily', name: 'Ann', email: 'ann@example.com' }, { digest: 'daily', name: 'Bob', email: null }] }));
  const md = C.dryRunMarkdown(d);
  assert.ok(!md.includes('very-secret-token'), 'no secret in the pack');
  for (const x of [...C.REPORTS, ...C.RULES]) assert.ok(md.includes(`| ${x.id} |`), x.id);
  for (const [id, desc] of Object.entries(C.DELIVERY)) {
    assert.ok([...C.REPORTS, ...C.RULES].some((x) => x.id === id), id);
    for (const k of [desc.arm, desc.list].filter(Boolean)) assert.ok(k in DEFAULTS, k);
  }
  for (const o of C.OTHER_SENDERS) for (const k of [o.arm, o.list].filter(Boolean)) assert.ok(k in DEFAULTS, k);
  const r01 = item(d, 'R01');
  assert.deepEqual(r01.recipients.filter((r) => !r.skip).map((r) => r.to), ['ann@example.com']);
  assert.match(md, /Bob \(no e-mail on the account → skipped\)/);
});

test('history lines: report_sent_log, sync failures + raised alerts, escalations, SLA log, unreadable source', () => {
  const h = { sent_log: [{ report_type: 'hygiene', result: 'ok', n: 3 }], sync_errors: [{ job: 'zoho.requests', n: 4 }], sync_alerts: [{ key: 'alert:fail:zoho.requests' }],
    escalations: [{ kind: 'A02', n: 5, open: 2 }], sla_alerts: [{ kind: 'fr_breach', n: 7 }], errors: { runs: 'relation "report_runs" does not exist' } };
  const d = C.buildDryRun(ctxOf({}, { history: h }));
  assert.equal(item(d, 'R12').fired, 'report_sent_log: 3 × ok');
  assert.equal(item(d, 'R11').fired, 'failed sync runs: zoho.requests 4. Alerts raised (dedup watermark set): fail:zoho.requests');
  assert.equal(item(d, 'A02').fired, '5 escalation(s) seen, 2 still open');
  assert.equal(item(d, 'A01').fired, 'no escalation seen');
  assert.equal(item(d, 'A07').fired, 'sla_alert_log: 7 × fr_breach');
  assert.match(item(d, 'R04').fired, /^unavailable \(relation/);
});

test('cli: args parsing is bounded', () => {
  assert.deepEqual(cli.parseArgs(['--days=7', '--out=x.md', '--json']), { days: 7, out: 'x.md', json: true });
  assert.equal(cli.parseArgs(['--days=0']).days, 30);
  assert.equal(cli.parseArgs(['--days=9999']).days, 30);
});

test('pg: the CLI reads the real schema in a READ ONLY session and changes nothing', async () => {
  assert.ok(process.env.PG_URL, 'PG_URL set by _pg-boot');
  const { Client } = require('pg');
  const w = new Client({ connectionString: process.env.PG_URL }); await w.connect();
  try {
    await w.query(`INSERT INTO report_config (key, value) VALUES ('sync_alert_enabled','1'), ('hygiene_recipients','grp@example.com')
                   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
    await w.query(`INSERT INTO report_recipients (site_code, coordinator_email, coordinator_email_confirmed, active) VALUES ('HGO','hgo.coord@example.com',1,1), ('MGO','mgo.coord@example.com',0,1)
                   ON CONFLICT (site_code) DO NOTHING`);
    const now = new Date();
    const iso = (ms) => new Date(now.getTime() - ms).toISOString();
    await w.query(`INSERT INTO sync_runs (job, started_at, status) VALUES ('zoho.requests',$1,'error'), ('zoho.requests',$2,'error'), ('zoho.requests',$3,'error')`, [iso(3600e3), iso(7200e3), iso(90 * 86400e3)]);
    await w.query(`INSERT INTO sync_watermarks (job, value, updated_at) VALUES ('alert:fail:zoho.requests',$1,$1) ON CONFLICT (job) DO UPDATE SET value=EXCLUDED.value, updated_at=EXCLUDED.updated_at`, [iso(3600e3)]);
    await w.query(`INSERT INTO report_sent_log (report_type, site_code, period, recipients, result) VALUES ('hygiene','GROUP','2026-W44','grp@example.com','ok')`);
    const count = async () => (await w.query(`SELECT (SELECT COUNT(*) FROM report_config)::int AS c, (SELECT COUNT(*) FROM report_sent_log)::int AS s,
      (SELECT COUNT(*) FROM sync_runs)::int AS r, (SELECT COUNT(*) FROM sync_watermarks)::int AS w`)).rows[0];
    const before = await count();

    let out = '';
    const pack = await cli.main({ args: { days: 30, out: null, json: false }, write: (s) => { out += s; } });
    assert.match(out, /\*\*R11 is armed but reaches nobody\*\*/);
    assert.equal(item(pack, 'R11').fired, 'failed sync runs: zoho.requests 2. Alerts raised (dedup watermark set): fail:zoho.requests');
    assert.equal(item(pack, 'R12').fired, 'report_sent_log: 1 × ok');
    assert.deepEqual(item(pack, 'A06').recipients.map((r) => r.site), ['HGO']);
    assert.ok(!(item(pack, 'R11').fired || '').startsWith('unavailable'));
    assert.deepEqual(await count(), before, 'nothing written');

    // every source the pack reads exists in the migrated schema, and the session refuses writes
    const s = await cli.readOnlySession(process.env.PG_URL);
    try { assert.deepEqual((await cli.gather(s.query, { days: 30 })).history.errors, {}); await assert.rejects(s.query(`INSERT INTO report_config (key, value) VALUES ('x','y')`), /read-only/); } finally { await s.close(); }
  } finally { await w.end(); }
});
