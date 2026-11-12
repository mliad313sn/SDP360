'use strict';
// A-09a — GET /api/reports/auth/me carries the UI policy ({user, ui}) so every page (auth.js) can cache it.
// A config read failure must never turn into a 500: the user block is returned without ui.
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'ui-policy-me-smoke-'));
for (const k of ['REPORTS_BACKEND', 'TRACKER_BACKEND', 'MEETINGS_BACKEND', 'INSPECTION_BACKEND', 'ASSETS_BACKEND']) process.env[k] = 'sqlite';
process.env.DASH_USER = process.env.DASH_USER || 'uipol-super';
process.env.DASH_PASS = process.env.DASH_PASS || 'uipol-pass-0000';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fetch = require('./_http-fetch');

let server, base, token;

before(async () => {
  const { app } = require('../server');
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
  const res = await fetch(base + '/api/reports/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: process.env.DASH_USER, password: process.env.DASH_PASS }),
  });
  assert.equal(res.status, 200);
  token = decodeURIComponent(/report_token=([^;]+)/.exec(String(res.headers.get('set-cookie')))[1]);
});
after(() => { try { server && server.close(); } catch {} });

const me = () => fetch(base + '/api/reports/auth/me', { headers: { 'x-report-token': token } });

test('auth/me returns the user and the default UI policy', async () => {
  const r = await me();
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.ok(body.user && body.user.username, 'user block kept');
  assert.deepStrictEqual(body.ui, { lang_default: '', i18n_pages: '0', role_landing: '0', nav_profile: 'full', deck_builder_roles: ['super_admin'], exec_nav: 'full', kpi_base_line: '0', kpi_sample_size: '0', small_multiples: '0', feedback: '0', data_quality_page: '0', url_filters: '0', nav_active_from_url: '0', home_blocks: '0', exec_charts_v2: '0', ux_events: '0' });
});

test('a saved switch is reflected in the ui block', async () => {
  const rdb = require('../reports-db');
  const reportConfig = require('../services/reportConfig');
  await reportConfig.setConfig(rdb.db, { ui_i18n_pages: '1', ui_lang_default: 'fr' }, 'test');
  try {
    const body = await (await me()).json();
    assert.strictEqual(body.ui.i18n_pages, '1');
    assert.strictEqual(body.ui.lang_default, 'fr');
  } finally {
    await reportConfig.setConfig(rdb.db, { ui_i18n_pages: '0', ui_lang_default: '' }, 'test');
  }
});

test('a config read failure still answers 200 with the user and no ui', async () => {
  const reportConfig = require('../services/reportConfig');
  const orig = reportConfig.getConfig;
  reportConfig.getConfig = () => Promise.reject(new Error('db down'));
  try {
    const r = await me();
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.ok(body.user);
    assert.ok(!('ui' in body), 'ui omitted');
  } finally { reportConfig.getConfig = orig; }
});
