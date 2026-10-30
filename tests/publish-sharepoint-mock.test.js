'use strict';
// G16 — SharePoint / Microsoft Graph publication, proven against a MOCKED transport (no tenant, no network):
// one list item per figure with a Bearer token, ids encoded in the URL, a failure that never leaks the token,
// and a silent skip when the configuration is incomplete.
const test = require('node:test');
const assert = require('node:assert');
const { publishScheduled } = require('../services/engagementJobs');

const registry = { has: (k) => k === 'helpdesk.resolution_sla_pct', get: () => ({ name: 'Resolution SLA', unit: '%', reader: 'x.site' }), resolve: async () => ({ value: 91.2, rag: 'GREEN', window: { label: 'Oct 2026' }, as_of: '2026-10-28T00:00:00Z' }) };
const rdb = { listSites: async () => [{ id: 1, name: 'Hounde' }, { id: 2, name: 'Ity' }] };
const sp = { sharepoint_tenant_id: 't', sharepoint_client_id: 'c', sharepoint_client_secret: 's', sharepoint_site_id: 'host,site/1', sharepoint_list_id: 'list 1', publish_metric_keys: 'helpdesk.resolution_sla_pct' };

function transport({ failOn = null } = {}) {
  const calls = [];
  const post = async (url, body, headers) => { calls.push({ url, body, headers }); if (failOn && calls.length === failOn) throw new Error('403 from Graph — Authorization: Bearer SECRET-TOKEN'); };
  post.token = async (cfg) => { assert.strictEqual(cfg.secret, 's'); return 'SECRET-TOKEN'; };
  return { post, calls };
}

test('one SharePoint item per figure, Bearer token, encoded ids', async () => {
  const t = transport();
  const out = await publishScheduled({ registry, deps: {}, rdb, cfg: sp, post: t.post });
  const graph = t.calls.filter((c) => c.url.startsWith('https://graph.microsoft.com/'));
  assert.strictEqual(out.sharepoint, 2);
  assert.strictEqual(graph.length, 2);
  assert.strictEqual(graph[0].url, 'https://graph.microsoft.com/v1.0/sites/host%2Csite%2F1/lists/list%201/items');
  assert.strictEqual(graph[0].headers.Authorization, 'Bearer SECRET-TOKEN');
  assert.deepStrictEqual(Object.keys(graph[0].body.fields).sort(), ['AsOf', 'Metric', 'Rag', 'Site', 'Title', 'Unit', 'Value', 'Window']);
  assert.strictEqual(graph[1].body.fields.Site, 'Ity');
});

test('a Graph failure is counted and never leaks the token', async () => {
  const t = transport({ failOn: 1 });
  const out = await publishScheduled({ registry, deps: {}, rdb, cfg: sp, post: t.post });
  assert.strictEqual(out.sharepoint, 0);
  assert.ok(out.skipped >= 1);
  assert.ok(!String(out.sharepoint_error).includes('SECRET-TOKEN'));
  assert.match(out.sharepoint_error, /<redacted>/);
});

test('incomplete configuration: nothing is sent to Graph', async () => {
  const t = transport();
  const out = await publishScheduled({ registry, deps: {}, rdb, cfg: { ...sp, sharepoint_client_secret: '' }, post: t.post });
  assert.strictEqual(out.sharepoint, 0);
  assert.strictEqual(t.calls.filter((c) => c.url.includes('graph.microsoft.com')).length, 0);
});

test('redaction: "Authorization: Bearer X" loses X (it used to keep it after a key=value pass)', () => {
  const { redactMessage } = require('../services/safeUrl');
  const out = redactMessage('403 — Authorization: Bearer SECRET-TOKEN; Zoho-oauthtoken 1000.abc', []);
  assert.ok(!out.includes('SECRET-TOKEN')); assert.ok(!out.includes('1000.abc'));
});
