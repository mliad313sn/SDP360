'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'reports.html'), 'utf8');

test('card exists with both arm toggles, schedule host and result box', () => {
  for (const id of ['ap-asset-reminders', 'arm-recap-enabled', 'arm-alert-enabled', 'arm-schedule-body', 'arm-result', 'arm-site'])
    assert.ok(src.includes(`id="${id}"`), id);
});

test('the five admin surfaces all name the panel', () => {
  assert.match(src, /'asset-reminders':'ap-asset-reminders'/, '_ADMIN_PANEL_IDS');
  assert.match(src, /members: \[[^\]]*'asset-reminders'[^\]]*\]/, 'PANEL_GROUPS.sends.members');
  assert.match(src, /'asset-reminders': 'Rappels parc'/, 'group tab label');
  assert.match(src, /name === 'asset-reminders'\) && currentUser\?\.role !== 'super_admin'|name === 'asset-reminders' \|\|/, 'super-gate');
  assert.match(src, /'asset-group','asset-reminders'\]\.includes\(sub\)/, 'hash allowlist');
  assert.match(src, /name === 'asset-reminders' && typeof loadAssetRemindersCard === 'function'/, 'loader hook');
});

test('directory modal carries the asset manager fields and submits them', () => {
  for (const id of ['rcp-am-name', 'rcp-am-email', 'rcp-am-confirmed']) assert.ok(src.includes(`id="${id}"`), id);
  assert.match(src, /asset_manager_email_confirmed: document\.getElementById\('rcp-am-confirmed'\)\.checked \? 1 : 0/);
});

test('a sent-but-not-logged result is shown as such, with its reason', () => {
  assert.ok(src.includes('envoyé (journal non écrit)'));
  assert.match(src, /x\.logFailed/);
});

test('route + schedule row wiring', () => {
  assert.ok(src.includes('/api/reports/asset-reminders/send'));
  assert.ok(src.includes("saveScheduleRow('asset_reminder','weekly')"));
  assert.ok(src.includes("t === 'asset_reminder' && typeof loadAssetRemindersCard === 'function'"), 'saveScheduleRow refreshes the owning card');
});
