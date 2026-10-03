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
    'tsla-filter', 'tsla-rules', 'tsla-channels', 'tsla-preview-out', 'tsla-groups']) assert.ok(src.includes(`id="${id}"`), id);
  assert.match(src, /id="tsla-client-secret"[^>]*type="password"|type="password"[^>]*id="tsla-client-secret"/);
});

test('wired on the four admin surfaces', () => {
  assert.match(src, /'teams-sla':'ap-teams-sla'/, '_ADMIN_PANEL_IDS');
  assert.match(src, /'asset-reminders','teams-sla'\]\.includes\(sub\)/, 'deep-link allowlist');
  assert.match(src, /id="admin-rail-teams-sla" style="display:none"/, 'rail item hidden by default');
  assert.match(src, /'admin-rail-teams-sla'/, 'rail shown for super_admin');
  assert.match(src, /name === 'teams-sla'\) && currentUser\?\.role !== 'super_admin'|name === 'teams-sla' \|\|/, 'super_admin guard');
  assert.match(src, /if \(name === 'teams-sla' && typeof loadTeamsSlaCard === 'function'\) loadTeamsSlaCard\(\);/);
});

test('the client talks to /api/teams-sla and never prefills a secret', () => {
  for (const r of ["'/api/teams-sla/settings'", "'/api/teams-sla/test'", "'/api/teams-sla/preview'", "'/api/teams-sla/run'"]) assert.ok(src.includes(r), r);
  const fn = src.slice(src.indexOf('function loadTeamsSlaCard'), src.indexOf('function saveTeamsSlaCard'));
  assert.ok(fn.length > 100, 'loader found');
  assert.ok(!/tsla-client-secret'\)\.value\s*=\s*[^'"]/.test(fn), 'secret field left blank on load');
});
