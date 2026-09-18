'use strict';
const test = require('node:test');
const assert = require('node:assert');
const cli = require('../tools/reports/send-asset-reminders');

const EMPTY = { counts: { new: 0, unassigned: 0, no_cost: 0, no_date: 0 }, new: [], unassigned: [], no_cost: [], no_date: [] };
const FULL = { counts: { new: 1, unassigned: 1, no_cost: 0, no_date: 0 },
  new: [{ asset_id: 'N1', asset_name: 'PC', has_cost: true, first_seen_date: '2026-07-28' }], unassigned: [{ asset_id: 'U1', asset_name: 'PC2', has_cost: false }], no_cost: [], no_date: [] };
const ROWS = [
  { site_code: 'HGO', active: 1, asset_manager_email: 'am@x', asset_manager_email_confirmed: 1, coordinator_email: 'c@x', coordinator_email_confirmed: 1, cc_emails: 'ignored@x' },
  { site_code: 'MGO', active: 1, asset_manager_email: 'am2@x', asset_manager_email_confirmed: 0, coordinator_email: 'c2@x', coordinator_email_confirmed: 1 },
  { site_code: 'SMI', active: 1, coordinator_email: 'c3@x', coordinator_email_confirmed: 0 },
  { site_code: 'KGO', active: 1, coordinator_email: 'c4@x', coordinator_email_confirmed: 1 },
  { site_code: 'OFF', active: 0, coordinator_email: 'c5@x', coordinator_email_confirmed: 1 },
];
function stub(over = {}) {
  const cap = { sends: [], records: [], windows: [] };
  const deps = {
    type: 'asset_reminder', db: {}, cfg: { asset_reminder_send_enabled: '1', asset_new_alert_enabled: '1', never_send_unconfirmed: '1', public_base_url: '' },
    listRecipients: async () => ROWS,
    loadSiteLabels: async (code) => (code === 'KGO' ? [] : ['L-' + code]),
    loadFollowups: async (labels, w) => { cap.windows.push(w); return labels[0] === 'L-SMI' ? EMPTY : FULL; },
    getPreviousWeek: () => ({ year: 2026, week: 30 }),
    getWeekRange: () => ({ start: '2026-07-26', end: '2026-08-01', label: 'W30 2026' }),
    now: new Date('2026-08-03T07:00:00Z'),
    mailerSend: async (m) => { cap.sends.push(m); return { ok: true }; },
    alreadySentToday: async () => false,
    record: async (db, row) => { cap.records.push(row); },
    ...over,
  };
  return { deps, cap };
}

test('requiring the CLI has no side effect and exports its core', () => {
  assert.strictEqual(typeof cli.main, 'function');
  assert.strictEqual(typeof cli.decideReminderSend, 'function');
  assert.strictEqual(typeof cli.recipientsFor, 'function');
});

test('gates: each type has its own arm flag; default OFF', () => {
  assert.strictEqual(cli.decideReminderSend('asset_reminder', {}), false);
  assert.strictEqual(cli.decideReminderSend('asset_reminder', { asset_reminder_send_enabled: '1' }), true);
  assert.strictEqual(cli.decideReminderSend('asset_new_alert', { asset_reminder_send_enabled: '1' }), false);
  assert.strictEqual(cli.decideReminderSend('asset_new_alert', { asset_new_alert_enabled: '1' }), true);
});

test('recipients: AM to + coordinator cc; unconfirmed AM → coordinator alone; none → null; cc_emails ignored', () => {
  assert.deepStrictEqual(cli.recipientsFor(ROWS, 'HGO', true), { to: 'am@x', cc: ['c@x'] });
  assert.deepStrictEqual(cli.recipientsFor(ROWS, 'MGO', true), { to: 'c2@x', cc: [] });
  assert.strictEqual(cli.recipientsFor(ROWS, 'SMI', true), null);
});

test('disarmed send → nothing composed, mailed or logged', async () => {
  const { deps, cap } = stub({ cfg: { asset_reminder_send_enabled: '0' } });
  const r = await cli.main(deps);
  assert.deepStrictEqual([r.sent, r.reason, cap.sends.length, cap.records.length], [0, 'disabled', 0, 0]);
});

test('weekly recap: window = previous Zoho week; skip reasons; dedup key = week label; ok logged', async () => {
  const { deps, cap } = stub();
  const r = await cli.main(deps);
  assert.strictEqual(r.sent, 2);                                    // HGO + MGO
  assert.deepStrictEqual(cap.windows[0], { newFrom: '2026-07-26', newTo: '2026-08-01' });
  const reasons = Object.fromEntries(r.results.filter(x => !x.ok).map(x => [x.site, x.reason]));
  assert.match(reasons.SMI, /nothing to report|no confirmed/);
  assert.match(reasons.KGO, /no asset label/);
  assert.ok(!r.results.some(x => x.site === 'OFF'), 'inactive directory rows are skipped');
  assert.deepStrictEqual(cap.records.map(x => [x.report_type, x.site_code, x.period, x.result]),
    [['asset_reminder', 'HGO', 'W30 2026', 'ok'], ['asset_reminder', 'MGO', 'W30 2026', 'ok']]);
  assert.strictEqual(cap.sends[0].to, 'am@x');
  assert.strictEqual(cap.sends[0].cc, 'c@x');
  assert.match(cap.sends[0].attachments[0].filename, /assets-suivi-HGO-2026-W30\.xlsx/);
});

test('dedup: already sent today → skipped (force overrides)', async () => {
  const a = stub({ alreadySentToday: async () => true });
  assert.strictEqual((await cli.main(a.deps)).sent, 0);
  const b = stub({ alreadySentToday: async () => true, force: true });
  assert.strictEqual((await cli.main(b.deps)).sent, 2);
  assert.deepStrictEqual(b.cap.records.map(x => x.result), ['resent', 'resent'], 'a forced re-send is logged resent (counts for dedup)');
});

test('new-asset alert: window = today UTC, period = YYYY-MM-DD, no new rows → skip', async () => {
  const { deps, cap } = stub({ type: 'asset_new_alert' });
  const r = await cli.main(deps);
  assert.deepStrictEqual(cap.windows[0], { newFrom: '2026-08-03', newTo: '2026-08-03' });
  assert.ok(cap.records.every(x => x.report_type === 'asset_new_alert' && x.period === '2026-08-03'));
  assert.strictEqual(r.results.find(x => x.site === 'SMI').ok, false);
});

test('preview ignores the gate, sends and logs nothing; --site narrows', async () => {
  const { deps, cap } = stub({ cfg: { asset_reminder_send_enabled: '0' }, preview: true, site: 'HGO' });
  const r = await cli.main(deps);
  assert.strictEqual(r.previewed, true);
  assert.deepStrictEqual(r.previews.map(p => p.site), ['HGO']);
  assert.deepStrictEqual([cap.sends.length, cap.records.length], [0, 0]);
});

test('a mail failure is logged fail and does not abort the other sites', async () => {
  let n = 0;
  const { deps, cap } = stub({ mailerSend: async () => (n++ === 0 ? { ok: false, error: 'smtp' } : { ok: true }) });
  const r = await cli.main(deps);
  assert.deepStrictEqual(cap.records.map(x => x.result), ['fail', 'ok']);
  assert.strictEqual(r.sent, 1);
});

test('--type parsing from args', async () => {
  const { deps } = stub({ type: undefined, args: { type: 'asset_new_alert' } });
  assert.strictEqual((await cli.main(deps)).type, 'asset_new_alert');
  const bad = stub({ type: undefined, args: { type: 'nope' } });
  await assert.rejects(() => cli.main(bad.deps), /unknown --type/);
});
