'use strict';
// Step 9 — engagement store on sqlite: rules + state, notifications/digest, subscriptions, share links (hash, expiry, views, revoke), API consumers (hash, quota).
const { test } = require('node:test');
const assert = require('node:assert');
const { makeEngagementStore, hash } = require('../services/engagementStore');
const { SEED_RULES } = require('../services/alertRulesSeed');

let clock = '2026-10-19T10:00:00.000Z';
async function fresh() { const db = (await require('./_pg-fresh').freshStore(['report_templates', 'report_runs', 'alert_rules', 'alert_state', 'alert_firings', 'notifications', 'notification_comments', 'subscriptions', 'share_links', 'share_views', 'api_consumers', 'api_calls'])); const s = makeEngagementStore(db, { now: () => clock }); await s.init(); return { s, db }; }

test('rules: validation, seed 12 once, partial update, state round-trip, firings + false-positive rate', async () => {
  const { s } = await fresh();
  await assert.rejects(async () => s.saveRule({ key: 'x y', metric: 'm' }), /rule key/);
  await assert.rejects(async () => s.saveRule({ key: 'k', metric: 'm', op: 'between' }), /op must be/);
  await assert.rejects(async () => s.saveRule({ key: 'k', metric: 'm', channels: ['sms'] }), /bad channel/);
  assert.equal((await s.seedRules(SEED_RULES)).length, SEED_RULES.length); assert.equal((await s.seedRules(SEED_RULES)).length, 0); assert.equal(SEED_RULES.length, 13);
  const r = await s.getRule('meetings.engagement.red'); assert.equal(r.threshold, 'RED'); assert.equal(r.cooldown_min, 10080); assert.deepEqual(r.recipients, { roles: ['admin'] });
  const u = await s.saveRule({ key: 'sla.resolution.red', threshold: 75, enabled: false }); assert.equal(u.threshold, 75); assert.equal(u.enabled, false); assert.equal(u.name, 'Resolution SLA below 80 %');
  assert.equal((await s.listRules({ includeDisabled: false })).length, SEED_RULES.length - 1);
  await s.saveState({ 'sla.resolution.red|3': { breaches: 2, last_fired_at: clock } }, { 'sla.resolution.red|3': 70 });
  await s.saveState({ 'sla.resolution.red|3': { breaches: 3, last_fired_at: clock } }); assert.deepEqual(await s.loadState(), { 'sla.resolution.red|3': { breaches: 3, last_fired_at: clock } });
  const f = { rule: r, reading: { site_id: 3, value: null }, message: 'm', key: 'k|3' }; const id1 = await s.recordFiring(f); await s.recordFiring(f);
  await s.markFalsePositive(id1, { note: 'holiday' }); const st = await s.firingStats(); assert.deepEqual(st, { firings: 2, false_positives: 1, false_positive_pct: 50 });
  assert.equal((await s.listFirings())[1].value, null, 'null reading stored as null, not 0');
  await s.removeRule('sla.resolution.red'); assert.deepEqual(await s.loadState(), {}, 'state removed with the rule');
});

test('G16 severity: saved with the rule, refused when unknown, kept on the firing', async () => {
  const { s } = await fresh();
  await assert.rejects(async () => s.saveRule({ key: 'k', metric: 'm', severity: 'urgent' }), /severity must be/);
  const r = await s.saveRule({ key: 'k', metric: 'm', severity: 'critical' }); assert.equal(r.severity, 'critical');
  assert.equal((await s.saveRule({ key: 'k2', metric: 'm' })).severity, 'warning', 'default warning');
  assert.equal((await s.saveRule({ key: 'k', threshold: 3 })).severity, 'critical', 'partial update keeps it');
  await s.recordFiring({ rule: r, severity: 'critical', reading: { site_id: null, value: 1 }, message: 'm', key: 'k|fleet' });
  await s.saveRule({ key: 'k', severity: 'info' });
  assert.equal((await s.listFirings())[0].severity, 'critical', 'a later rule change does not rewrite what was fired');
});

test('notifications: unread count, mark read (own only), digest pull marks digested once, comments require a body', async () => {
  const { s } = await fresh();
  const a = await s.notify({ userId: 1, kind: 'alert', title: 'A', body: 'b', sourceKind: 'alert_rule', sourceRef: 'k|3' }); await s.notify({ userId: 1, kind: 'report', title: 'B' }); await s.notify({ userId: 2, kind: 'report', title: 'C' });
  assert.equal(await s.unreadCount(1), 2); assert.equal(await s.markRead(2, [a]), 0, 'another user cannot read mine'); assert.equal(await s.markRead(1, [a]), 1);
  assert.equal((await s.listNotifications(1, { unreadOnly: true })).length, 1);
  assert.equal((await s.pullForDigest(1)).length, 1); assert.equal((await s.pullForDigest(1)).length, 0, 'digested once'); assert.equal(await s.markAllRead(1), 1);
  await assert.rejects(async () => s.addComment({ sourceKind: 'alert_rule', sourceRef: 'k|3', user: { id: 1 }, body: '  ' }), /comment body/);
  const c = await s.addComment({ sourceKind: 'alert_rule', sourceRef: 'k|3', user: { id: 1, full_name: 'Ann' }, body: 'looking' }); assert.equal(c.user_name, 'Ann');
  assert.equal((await s.listComments('alert_rule', 'k|3')).length, 1);
});

test('subscriptions: kinds/channels validated, idempotent per (user, kind, target, channel), digest subscribers distinct', async () => {
  const { s } = await fresh();
  await assert.rejects(async () => s.subscribe(1, { kind: 'nope', target_key: 'x' }), /kind must be/);
  await assert.rejects(async () => s.subscribe(1, { kind: 'dashboard', target_key: 'x', digest: 'hourly' }), /bad channel or digest/);
  const id = await s.subscribe(1, { kind: 'report_template', target_key: 'site-weekly-pack', digest: 'daily' });
  assert.equal(await s.subscribe(1, { kind: 'report_template', target_key: 'site-weekly-pack', digest: 'weekly' }), id);
  await s.subscribe(2, { kind: 'dashboard', target_key: 'exec-home', digest: 'weekly' });
  assert.deepEqual((await s.subscribersOf('report_template', 'site-weekly-pack')).map(x => x.user_id), [1]); assert.deepEqual(await s.digestSubscribers('weekly'), [1, 2]);
  await s.unsubscribe(2, id); assert.equal((await s.listSubscriptions(1)).length, 1, 'another user cannot remove mine'); await s.unsubscribe(1, id); assert.equal((await s.listSubscriptions(1)).length, 0);
});

test('share links: token hashed at rest, ttl clamped to 90 days, views counted + receipts, max_views exhausts, expiry and revoke → null', async () => {
  const { s, db } = await fresh();
  await assert.rejects(async () => s.createShareLink({ targetKind: 'file', targetKey: 'x' }), /target_kind must be/);
  const l = await s.createShareLink({ targetKind: 'dashboard', targetKey: 'exec-home', siteId: 3, ttlHours: 999999, maxViews: 2, user: { id: 1 } });
  assert.equal((await db.prepare('SELECT token_hash FROM share_links WHERE id=?').get(l.id)).token_hash, hash(l.token)); assert.ok(!JSON.stringify(await s.listShareLinks()).includes(l.token));
  assert.equal(Math.round((new Date(l.expires_at) - Date.parse(clock)) / 36e5), 24 * 90);
  const o = await s.openShareLink(l.token, { agent: 'UA', ip: '10.0.0.1' }); assert.equal(o.views, 1); assert.equal(o.target_key, 'exec-home');
  await s.openShareLink(l.token); assert.equal(await s.openShareLink(l.token), null, 'max_views exhausted'); assert.equal((await s.shareReceipts(l.id)).length, 2);
  assert.equal(await s.openShareLink('nope'), null);
  const l2 = await s.createShareLink({ targetKind: 'report_run', targetKey: '12', ttlHours: 1 }); clock = '2026-10-19T12:00:00.000Z'; assert.equal(await s.openShareLink(l2.token), null, 'expired'); clock = '2026-10-19T10:00:00.000Z';
  const l3 = await s.createShareLink({ targetKind: 'report_run', targetKey: '12' }); await s.revokeShareLink(l3.id); assert.equal(await s.openShareLink(l3.token), null, 'revoked');
});

test('API consumers: key shown once and hashed, scopes validated, quota per day → quota error, revoke, call stats + purge', async () => {
  const { s, db } = await fresh();
  await assert.rejects(async () => s.createConsumer({ name: 'x', scopes: ['admin:write'] }), /scopes must be/);
  const c = await s.createConsumer({ name: 'Power BI', quotaPerDay: 2 }); assert.ok(c.key.startsWith('sdp_')); assert.equal(c.hint, c.key.slice(0, 8) + '…' + c.key.slice(-4));
  assert.equal((await db.prepare('SELECT key_hash FROM api_consumers WHERE id=?').get(c.id)).key_hash, hash(c.key)); assert.equal((await s.listConsumers())[0].key_hash, undefined);
  assert.deepEqual(await s.authenticate('sdp_wrong'), { error: 'unknown' });
  let a = await s.authenticate(c.key); assert.equal(a.quota_left, 2);
  await s.logCall(c.id, { path: '/ext/v1/metrics', status: 200, ms: 5 }); await s.logCall(c.id, { path: '/ext/v1/values', status: 500, ms: 9 });
  a = await s.authenticate(c.key); assert.equal(a.error, 'quota'); assert.equal(a.used, 2);
  assert.deepEqual(await s.callStats(), [{ consumer_id: c.id, calls: 2, errors: 1 }]);
  await s.revokeConsumer(c.id); assert.equal((await s.authenticate(c.key)).error, 'revoked');
  (await db.prepare("UPDATE api_calls SET called_at='2020-01-01T00:00:00Z'").run()); assert.equal(await s.purgeCalls({ days: 90 }), 2);
});
