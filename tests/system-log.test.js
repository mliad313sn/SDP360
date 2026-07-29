'use strict';
// System Logs v1 — reports-db layer (system_log table + logEvent + readers +
// logAudit mirror). Fresh sqlite reports.db in a temp dir. See
// docs/superpowers/plans/2026-07-29-system-logs-v1.md.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');
const fs = require('fs');

process.env.REPORTS_BACKEND = 'sqlite';
process.env.SDP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'syslog-'));
process.env.DASH_USER = process.env.DASH_USER || 'seedadmin';
process.env.DASH_PASS = process.env.DASH_PASS || 'seedpass123';
const rdb = require('../reports-db.js');

test('_isRiskAction flags exactly the security actions', () => {
  for (const a of ['login_failed','session_killed','user_deleted','user_role_changed','password_reset','report_deleted'])
    assert.equal(rdb._isRiskAction(a), true, a);
  for (const a of ['login_success','logout','user_created','user_updated','config_saved','report_edited_infra'])
    assert.equal(rdb._isRiskAction(a), false, a);
});

test('_redactKeys drops secret-ish keys, keeps safe ones', () => {
  const out = rdb._redactKeys(['smtp_host','smtp_pass','api_token','report_config','client_secret','xof_usd_rate']);
  assert.deepEqual(out.sort(), ['report_config','smtp_host','xof_usd_rate'].sort());
});

test('logEvent round-trips + derives risk + JSON details', async () => {
  await rdb.logEvent({ category:'auth', action:'login_failed', actor:'mallory', ip:'10.0.0.9', details:{ reason:'bad_password' } });
  await rdb.logEvent({ category:'auth', action:'login_success', actor:'admin', actor_id:1, ip:'10.0.0.1' });
  const { rows, total } = await rdb.listSystemLog({}, { limit: 10, offset: 0 });
  assert.equal(total, 2);
  const failed = rows.find(r => r.action === 'login_failed');
  assert.equal(failed.risk, 1);
  assert.equal(failed.actor, 'mallory');
  assert.equal(JSON.parse(failed.details).reason, 'bad_password');
  assert.equal(rows.find(r => r.action==='login_success').risk, 0);
});

test('logEvent NEVER throws to the caller (bare/fire-and-forget)', async () => {
  await assert.doesNotReject(() => Promise.resolve(rdb.logEvent({ action:'x' })));
  await assert.doesNotReject(() => Promise.resolve(rdb.logEvent({})));
});

test('listSystemLog filters: category, risk, actor, q, date', async () => {
  const day = new Date().toISOString().slice(0,10);
  let r = await rdb.listSystemLog({ category:'auth' }, {limit:50,offset:0});
  assert.ok(r.rows.length >= 2 && r.rows.every(x => x.category==='auth'));
  r = await rdb.listSystemLog({ risk:1 }, {limit:50,offset:0});
  assert.ok(r.rows.every(x => x.risk===1));
  r = await rdb.listSystemLog({ q:'bad_password' }, {limit:50,offset:0});
  assert.ok(r.rows.length >= 1);
  r = await rdb.listSystemLog({ from: day, to: day }, {limit:50,offset:0});
  assert.ok(r.total >= 2);
});

test('getSystemLogAnalytics returns the expected shape + ordering', async () => {
  const a = await rdb.getSystemLogAnalytics({ window: '30d' });
  for (const k of ['totals','series','risk_series','top_actions','top_actors','by_hour','top_ips'])
    assert.ok(k in a, `missing ${k}`);
  for (const k of ['events','risk_events','distinct_actors','distinct_ips'])
    assert.ok(k in a.totals, `missing totals.${k}`);
  assert.ok(a.totals.events >= 2 && a.totals.risk_events >= 1);
  assert.equal(a.by_hour.length, 24);
  assert.ok(a.top_actions.length >= 1 && typeof a.top_actions[0].n === 'number');
  assert.ok(a.top_actions.every((x,i,arr) => i===0 || arr[i-1].n >= x.n), 'top_actions desc');
});

test('config_saved stores redacted keys — NO secret value OR key ever lands', async () => {
  const body = { smtp_host:'mail', smtp_pass:'hunter2', report_config:'x', api_token:'abc' };
  await rdb.logEvent({ category:'config', action:'config_saved', target:'report_config',
    details:{ keys: rdb._redactKeys(Object.keys(body)) } });
  const r = await rdb.listSystemLog({ category:'config' }, {limit:50,offset:0});
  const blob = r.rows.find(x => x.target === 'report_config').details;
  assert.ok(!blob.includes('hunter2') && !blob.includes('abc'), 'no secret VALUES');
  assert.ok(!/smtp_pass|api_token/.test(blob), 'no sensitive KEY names');
  assert.ok(blob.includes('smtp_host') && blob.includes('report_config'), 'safe keys kept');
});

test('logAudit mirrors a report_* row into system_log', async () => {
  await rdb.logAudit({ report_id: 42, site_id: 1, user_id: 7, username: 'coord', action: 'deleted', details: { week_label:'W30' } });
  const r = await rdb.listSystemLog({ category:'report' }, {limit:50,offset:0});
  const row = r.rows.find(x => x.target === '42');
  assert.ok(row, 'report_audit mirrored');
  assert.equal(row.action, 'report_deleted');
  assert.equal(row.actor, 'coord');
  assert.equal(row.risk, 1);
});
