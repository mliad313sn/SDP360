'use strict';
// Teams SLA alerts — the 5-minute job (tools/teams/poll-sla.js). Every dependency is
// injected: config, SDP client, webhook POST, anti-duplicate log, clock. Never throws.
const test = require('node:test');
const assert = require('node:assert');
const { run } = require('../tools/teams/poll-sla');

const NOW = Date.parse('2026-10-03T10:00:00Z');
const min = (m) => String(NOW + m * 60000);
const REQ = (id, group, o = {}) => ({ id, display_id: id, subject: 'S' + id, priority: { name: 'High' }, group: { name: group },
  technician: { name: 'Awa' }, status: { name: 'Open' }, created_time: { value: min(-60) },
  first_response_due_by_time: { value: min(10) }, ...o });

function memLog() {
  const sent = new Set();
  return {
    sent,
    filterUnsent: async (db, a) => a.filter(x => !sent.has(x.request_id + '|' + x.kind)),
    record: async (db, a) => a.forEach(x => sent.add(x.request_id + '|' + x.kind)),
    purge: async () => 0,
  };
}
function deps(over = {}) {
  const posts = [];
  const cfgWrites = [];
  return {
    posts, cfgWrites,
    config: {
      teams_sla_enabled: '1', teams_sla_rules: '',
      teams_sla_channels: JSON.stringify([{ group: 'Hounde IT Agents', url: 'https://hook/hounde' }]),
      sdp_api_base_url: 'https://sdp.example/app/itdesk/api/v3',
    },
    client: { configured: true, listOpenRequests: async () => [REQ('1', 'Hounde IT Agents'), REQ('2', 'Hounde IT Agents'), REQ('3', 'Mana IT Agents')] },
    post: async (url, card) => { posts.push({ url, card }); },
    log: memLog(),
    setConfig: async (patch) => { cfgWrites.push(patch); },
    now: () => NOW,
    ...over,
  };
}

test('posts ONE card per mapped group, records what was sent, skips unmapped groups', async () => {
  const d = deps();
  const r = await run({ deps: d });
  assert.equal(d.posts.length, 1);
  assert.equal(d.posts[0].url, 'https://hook/hounde');
  assert.match(JSON.stringify(d.posts[0].card), /#1.*#2|#2.*#1/s);
  assert.equal(r.sent, 2);
  assert.deepEqual(r.unmapped, ['Mana IT Agents']);
  assert.ok(d.log.sent.has('1|fr_soon') && !d.log.sent.has('3|fr_soon'), 'unmapped alerts are NOT recorded');
  assert.ok(d.cfgWrites.some(p => p.teams_sla_last_run), 'heartbeat stamped');
});

test('a second pass sends nothing new (one alert per ticket and kind)', async () => {
  const d = deps();
  await run({ deps: d });
  const r2 = await run({ deps: d });
  assert.equal(d.posts.length, 1);
  assert.equal(r2.sent, 0);
});

test('a failed webhook records nothing for that group (retried next pass) and hides the URL', async () => {
  const d = deps({ post: async () => { throw new Error('connect ECONNREFUSED https://hook/hounde'); } });
  const r = await run({ deps: d });
  assert.equal(r.sent, 0);
  assert.equal(d.log.sent.size, 0);
  assert.equal(r.failures.length, 1);
  assert.ok(!JSON.stringify(r).includes('https://hook/hounde'), 'the webhook URL is a secret');
});

test('disarmed → nothing at all; dry-run → a preview, no post, no record, even when disarmed', async () => {
  const d = deps(); d.config.teams_sla_enabled = '0';
  const r = await run({ deps: d });
  assert.equal(r.skipped, 'disarmed'); assert.equal(d.posts.length, 0);
  const p = await run({ deps: d, dryRun: true });
  assert.equal(d.posts.length, 0); assert.equal(d.log.sent.size, 0);
  const groups = p.preview.map(g => [g.group, g.has_channel, g.alerts.length]);
  assert.deepEqual(groups, [['Hounde IT Agents', true, 2], ['Mana IT Agents', false, 1]]);
  assert.equal(p.tickets, 3);
});

test('unconfigured SDP API or no channel → a reason, never a throw', async () => {
  assert.equal((await run({ deps: deps({ client: { configured: false, listOpenRequests: async () => [] } }) })).skipped, 'sdp_api_not_configured');
  const d = deps(); d.config.teams_sla_channels = '';
  assert.equal((await run({ deps: d })).skipped, 'no_channels');
});

test('an SDP API failure is reported, nothing recorded', async () => {
  const d = deps({ client: { configured: true, listOpenRequests: async () => { throw new Error('SDP GET /requests → HTTP 401'); } } });
  const r = await run({ deps: d });
  assert.match(r.error, /HTTP 401/);
  assert.equal(d.posts.length, 0);
});

test('two passes never overlap', async () => {
  let release;
  const d = deps({ client: { configured: true, listOpenRequests: () => new Promise(res => { release = () => res([]); }) } });
  const first = run({ deps: d });
  const second = await run({ deps: d });
  assert.equal(second.skipped, 'already_running');
  release(); await first;
});

test('groups differing only by case make ONE card', async () => {
  const d = deps({ client: { configured: true, listOpenRequests: async () => [REQ('1', 'Hounde IT Agents'), REQ('2', 'HOUNDE it agents')] } });
  const r = await run({ deps: d });
  assert.equal(d.posts.length, 1); assert.equal(r.sent, 2);
});

test('the preview reports the status mix and whether the list was capped', async () => {
  const many = Array.from({ length: 3 }, (_, i) => REQ(String(i), 'G', { status: { name: i ? 'Open' : 'Closed' } }));
  const d = deps({ client: { configured: true, pageCap: 3, listOpenRequests: async () => many } });
  const p = await run({ deps: d, dryRun: true });
  assert.deepEqual(p.by_status, { Open: 2, Closed: 1 });
  assert.equal(p.truncated, true, 'as many rows as the cap → probably truncated');
});

test('the job asks the client for tickets younger than max_ticket_age_days', async () => {
  let asked;
  const d = deps({ client: { configured: true, listOpenRequests: async (o) => { asked = o; return []; } } });
  d.config.teams_sla_rules = JSON.stringify({ max_ticket_age_days: 7 });
  await run({ deps: d });
  assert.equal(asked.createdAfterMs, NOW - 7 * 86400000);
});
