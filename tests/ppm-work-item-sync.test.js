'use strict';
// W4-CONNECTORS — Jira / Azure DevOps read-only pull, pure parts + the clients over a FAKE transport (no network):
// mapping (status, estimate, dates; unknown stays null), idempotent planning (create / update only changed owned fields /
// unchanged / deleted locally / missing upstream), query building, paging, read-only verbs, secrets never in errors.
const { test } = require('node:test');
const assert = require('node:assert');
const W = require('../services/ppm/workItemSync');
const C = require('../services/ppm/workItemClient');

const jira = (key, cat, extra = {}) => ({ key, fields: { summary: 'S ' + key, status: { name: cat, statusCategory: { key: cat } }, issuetype: { name: 'Story' }, ...extra } });

test('Jira issue → item: status category, estimate in hours, due date, unknown progress stays null', () => {
  const a = W.mapJiraIssue(jira('ABC-1', 'new', { timeoriginalestimate: 7200, duedate: '2027-03-01' }), { baseUrl: 'https://fict.example/' });
  assert.deepStrictEqual([a.external_key, a.name, a.status, a.progress_pct, a.effort_hours, a.deadline, a.external_url], ['ABC-1', '[ABC-1] S ABC-1', 'todo', null, 2, '2027-03-01', 'https://fict.example/browse/ABC-1']);
  const b = W.mapJiraIssue(jira('ABC-2', 'done'));
  assert.deepStrictEqual([b.status, b.progress_pct, b.effort_hours, b.deadline], ['done', 100, null, null]);
  assert.strictEqual(W.mapJiraIssue(jira('ABC-3', 'indeterminate')).status, 'in_progress');
});

test('Azure DevOps work item → item: states, estimate, start+target only together, Removed = cancelled', () => {
  const f = (state, x = {}) => ({ id: 42, fields: { 'System.Title': 'T', 'System.State': state, 'System.WorkItemType': 'Task', ...x } });
  const a = W.mapAzdoItem(f('Active', { 'Microsoft.VSTS.Scheduling.OriginalEstimate': 6, 'Microsoft.VSTS.Scheduling.StartDate': '2027-01-04T00:00:00Z', 'Microsoft.VSTS.Scheduling.TargetDate': '2027-01-08T00:00:00Z' }), { orgUrl: 'https://dev.example/org', project: 'P 1' });
  assert.deepStrictEqual([a.external_key, a.status, a.effort_hours, a.start_date, a.end_date, a.deadline], ['42', 'in_progress', 6, '2027-01-04', '2027-01-08', '2027-01-08']);
  assert.strictEqual(a.external_url, 'https://dev.example/org/P%201/_workitems/edit/42');
  const b = W.mapAzdoItem(f('New', { 'Microsoft.VSTS.Scheduling.StartDate': '2027-01-04' }));
  assert.deepStrictEqual([b.status, b.start_date, b.end_date, b.effort_hours], ['todo', null, null, null]);
  assert.strictEqual(W.mapAzdoItem(f('Closed')).status, 'done');
  assert.strictEqual(W.mapAzdoItem(f('Removed')).status, 'cancelled');
});

test('queries: project key → JQL, JQL kept; WIQL escapes quotes', () => {
  assert.strictEqual(W.jiraQuery('ABC'), 'project = "ABC" ORDER BY key ASC');
  assert.strictEqual(W.jiraQuery('labels = ppm'), 'labels = ppm');
  assert.throws(() => W.jiraQuery(''), /required/);
  assert.match(W.azdoWiql("Area\\O'Brien", 'Proj'), /UNDER 'Area\\O''Brien'/);
  assert.throws(() => W.azdoWiql('a\nb', 'P'), /invalid/);
});

test('planSync: idempotent upsert by external key; only changed owned non-null fields; deletions never resurrected', () => {
  const items = [W.mapJiraIssue(jira('K-1', 'done')), W.mapJiraIssue(jira('K-2', 'new', { timeoriginalestimate: 3600 })), W.mapJiraIssue(jira('K-3', 'new')), W.mapJiraIssue(jira('K-4', 'new')), W.mapJiraIssue(jira('K-1', 'done'))];
  const links = [{ external_key: 'K-1', task_id: 1 }, { external_key: 'K-2', task_id: 2 }, { external_key: 'K-4', task_id: 4 }, { external_key: 'K-9', task_id: 9 }];
  const tasks = { 1: { name: '[K-1] S K-1', status: 'in_progress', progress_pct: 50, effort_hours: 8 }, 2: { name: '[K-2] S K-2', status: 'todo', progress_pct: null, effort_hours: 1 }, 4: { deleted: true }, 9: { name: 'x' } };
  const p = W.planSync({ items, links, tasks });
  assert.deepStrictEqual(p.create.map((i) => i.external_key), ['K-3']);
  assert.deepStrictEqual(p.update.map((u) => [u.task_id, u.patch]), [[1, { status: 'done', progress_pct: 100 }]], 'effort 8 kept: unknown upstream never clears');
  assert.deepStrictEqual(p.unchanged.map((u) => u.task_id), [2]);
  assert.deepStrictEqual(p.deleted_locally, [{ external_key: 'K-4', task_id: 4 }]);
  assert.deepStrictEqual(p.missing_upstream, [{ external_key: 'K-9', task_id: 9 }]);
  assert.deepStrictEqual(p.skipped, [{ external_key: 'K-1', reason: 'DUPLICATE' }]);
  // a second plan after applying is a no-op for the same data
  const after = { ...tasks, 1: { ...tasks[1], status: 'done', progress_pct: 100 }, 3: { name: '[K-3] S K-3', status: 'todo' } };
  const p2 = W.planSync({ items: items.slice(0, 3), links: [...links, { external_key: 'K-3', task_id: 3 }], tasks: after });
  assert.strictEqual(p2.create.length + p2.update.length, 0);
  assert.deepStrictEqual(W.summarize(p2), { create: 0, update: 0, unchanged: 3, deleted_locally: 0, missing_upstream: 2, skipped: 0 });
});

test('Jira client: GET only, pages, Basic or Bearer auth, token never in the error', async () => {
  const calls = [];
  const http = { get: async (url, o) => { calls.push({ m: 'GET', url, auth: o.headers.Authorization }); const s = Number(/startAt=(\d+)/.exec(url)[1]); return { data: { total: 150, issues: Array.from({ length: s === 0 ? 100 : 50 }, (_, i) => jira('P-' + (s + i), 'new')) } }; },
    post: async () => { throw new Error('POST must never be used for Jira'); } };
  const r = await C.fetchJira({ baseUrl: 'https://fict.example', user: 'u@fict.example', token: 'tok-SECRET-1', jql: 'project = "P"', http });
  assert.strictEqual(r.items.length, 150);
  assert.ok(calls.every((c) => c.m === 'GET' && c.auth.startsWith('Basic ') && !c.url.includes('tok-SECRET-1')));
  const r2 = await C.fetchJira({ baseUrl: 'https://fict.example', token: 'pat-x', jql: 'x', http: { get: async (u, o) => { assert.strictEqual(o.headers.Authorization, 'Bearer pat-x'); return { data: { total: 0, issues: [] } }; } } });
  assert.strictEqual(r2.items.length, 0);
  await assert.rejects(C.fetchJira({ baseUrl: 'https://fict.example', token: 'tok-SECRET-1', jql: 'x', http: { get: async () => { const e = new Error('boom tok-SECRET-1'); e.response = { status: 401 }; throw e; } } }),
    (e) => e.reason === 'CONNECTOR_READ_FAILED' && !e.message.includes('tok-SECRET-1'));
  await assert.rejects(C.fetchJira({ baseUrl: '', token: '', jql: 'x', http }), (e) => e.reason === 'CONNECTOR_NOT_CONFIGURED');
});

test('Azure DevOps client: one WIQL query POST then batched GETs, PAT in Basic, bounded', async () => {
  const seen = [];
  const http = { post: async (url, body) => { seen.push(['POST', url]); assert.match(body.query, /^SELECT \[System\.Id\]/); return { data: { workItems: Array.from({ length: 250 }, (_, i) => ({ id: i + 1 })) } }; },
    get: async (url, o) => { seen.push(['GET', url]); assert.ok(o.headers.Authorization.startsWith('Basic ')); const ids = /ids=([\d,]+)/.exec(url)[1].split(','); return { data: { value: ids.map((id) => ({ id: Number(id), fields: { 'System.Title': 't', 'System.State': 'New' } })) } }; } };
  const r = await C.fetchAzdo({ orgUrl: 'https://dev.example/org', project: 'P', pat: 'pat-1', wiql: W.azdoWiql('A', 'P'), maxItems: 220, http });
  assert.strictEqual(r.items.length, 220); assert.strictEqual(r.truncated, true);
  assert.deepStrictEqual(seen.map((s) => s[0]), ['POST', 'GET', 'GET']);
  assert.ok(seen[0][1].includes('/_apis/wit/wiql'));
});
