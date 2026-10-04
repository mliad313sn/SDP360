'use strict';
// Teams SLA alerts — the admin card in reports.html. An admin panel is only live when it
// is wired on its four surfaces (CLAUDE.md pitfall): _ADMIN_PANEL_IDS, the deep-link
// allowlist, the super_admin rail gate, the showAdminPanel guard (+ its loader).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../public/reports.html'), 'utf8').replace(/\r\n/g, '\n');

test('the panel exists with its fields', () => {
  assert.match(src, /<div class="card admin-panel" id="ap-teams-sla" data-panel="teams-sla">/);
  for (const id of ['tsla-enabled', 'tsla-base', 'tsla-accounts', 'tsla-client-id', 'tsla-client-secret', 'tsla-refresh',
    'tsla-filter', 'tsla-max-age', 'tsla-rules', 'tsla-channels', 'tsla-preview-out', 'tsla-groups']) assert.ok(src.includes(`id="${id}"`), id);
  assert.match(src, /id="tsla-client-secret"[^>]*type="password"|type="password"[^>]*id="tsla-client-secret"/);
});

test('wired on the four admin surfaces', () => {
  assert.match(src, /'teams-sla':'ap-teams-sla'/, '_ADMIN_PANEL_IDS');
  assert.match(src, /'asset-reminders','teams-sla'[^\]]*\]\.includes\(sub\)/, 'deep-link allowlist');
  // one rail entry « Intégration API » groups the two tabs (Alertes SLA, Analytics)
  assert.match(src, /data-group="api" id="admin-rail-grp-api" style="display:none"/, 'rail group hidden by default');
  assert.match(src, /'admin-rail-grp-api'/, 'rail shown for super_admin');
  assert.match(src, /api:\s*\{ label: 'Intégration API'[^}]*members: \['teams-sla', 'analytics-api'\]/, 'PANEL_GROUPS.api');
  assert.ok(!src.includes('id="admin-rail-teams-sla"'), 'no stand-alone rail item any more');
  assert.match(src, /name === 'teams-sla'\) && currentUser\?\.role !== 'super_admin'|name === 'teams-sla' \|\|/, 'super_admin guard');
  assert.match(src, /if \(name === 'teams-sla' && typeof loadTeamsSlaCard === 'function'\) loadTeamsSlaCard\(\);/);
});

test('the client talks to /api/teams-sla and never prefills a secret', () => {
  for (const r of ["'/api/teams-sla/settings'", "'/api/teams-sla/test'", "'/api/teams-sla/preview'", "'/api/teams-sla/run'"]) assert.ok(src.includes(r), r);
  const fn = src.slice(src.indexOf('function loadTeamsSlaCard'), src.indexOf('function saveTeamsSlaCard'));
  assert.ok(fn.length > 100, 'loader found');
  assert.ok(!/tsla-client-secret'\)\.value\s*=\s*[^'"]/.test(fn), 'secret field left blank on load');
});

test('the Analytics tab: panel, fields, four surfaces, write-only secrets', () => {
  assert.match(src, /<div class="card admin-panel" id="ap-analytics-api" data-panel="analytics-api">/);
  for (const id of ['an-client-id', 'an-client-secret', 'an-refresh', 'an-workspace', 'an-org', 'an-accounts', 'an-status'])
    assert.ok(src.includes(`id="${id}"`), id);
  assert.match(src, /'analytics-api':'ap-analytics-api'/);
  assert.match(src, /'teams-sla','analytics-api'\]\.includes\(sub\)/);
  assert.match(src, /name === 'teams-sla' \|\| name === 'analytics-api'\) && currentUser\?\.role !== 'super_admin'/);
  assert.match(src, /if \(name === 'analytics-api' && typeof loadAnalyticsApiCard === 'function'\) loadAnalyticsApiCard\(\);/);
  for (const r of ["'/api/integrations/analytics'", "'/api/integrations/analytics/test'"]) assert.ok(src.includes(r), r);
  const fn = src.slice(src.indexOf('function loadAnalyticsApiCard'), src.indexOf('function saveAnalyticsApiCard'));
  assert.ok(fn.length > 100 && !/an-(client-secret|refresh)'\)\.value\s*=\s*[^'"]/.test(fn), 'secrets never prefilled');
});

test('the age limit has its own field, merged into the rules on save', () => {
  const fn = src.slice(src.indexOf('function saveTeamsSlaCard'), src.indexOf('function testTeamsSlaChannel'));
  assert.match(fn, /max_ticket_age_days/);
});

test('every inline <script> of reports.html still compiles (one bad quote kills the whole admin console)', () => {
  const re = /<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g;
  let m, n = 0;
  while ((m = re.exec(src))) { assert.doesNotThrow(() => new Function(m[1])); n++; }
  assert.ok(n >= 1);
});
