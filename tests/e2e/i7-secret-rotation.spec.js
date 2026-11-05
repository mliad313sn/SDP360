'use strict';
// C-23 (G52) I7 — secret rotation with SDP_CONFIG_KEY set (a random per-run key, this process only). A super_admin
// stores the Meridian inbound API key on the admin page, then rotates it (re-save):
//   • at rest the value is an encrypted box, never the plaintext;
//   • the OLD key stops working on the key-guarded route the moment the new one is saved, the NEW key works;
//   • neither value ever comes back to the browser — not in the GET of the settings, not in the PUT answer —
//     and neither reaches system_log; a blank re-save keeps the stored key;
//   • every secret-shaped setting is redacted on GET (checked with sharepoint_client_secret too).
// Then the dashboard API key: injected into the protected pages for a valid session only, never for an
// anonymous visitor, and an anonymous /api call is refused.
const crypto = require('crypto');
process.env.SDP_CONFIG_KEY = 'e2e-config-key-' + crypto.randomBytes(16).toString('hex');
const assert = require('node:assert');
const path = require('path');
const { runJourney } = require('./fixtures/harness');
const { api, raw } = require('./fixtures/iam');

const ROOT = path.join(__dirname, '..', '..');

runJourney('I7 secret rotation old key refused nothing leaks dash key not injected for anonymous', async ({ app, base, world, browser, j, login }) => {
  const H = app.rdb.pgHandle();
  const secrets = require(path.join(ROOT, 'services', 'configSecrets.js'));
  const OLD = 'mer-old-' + crypto.randomBytes(12).toString('hex');
  const NEW = 'mer-new-' + crypto.randomBytes(12).toString('hex');
  const SP = 'sp-secret-' + crypto.randomBytes(12).toString('hex');
  const callMeridian = async (key) => (await raw(base, 'GET', '/api/actions/open', key ? { 'X-API-Key': key } : {})).status;
  const stored = async (k) => String(((await H.prepare('SELECT value FROM report_config WHERE key = ?').get(k)) || {}).value || '');
  const saw = [];   // every body the browser received from the settings routes

  const ctx = await j.newContext(browser); const page = await ctx.newPage();
  page.on('response', async (r) => { if (/\/api\/reports\/config/.test(r.url())) { try { saw.push(r.request().method() + ' ' + await r.text()); } catch (_) {} } });
  await login(page, world.users.sa, '/reports.html#admin/meridian');
  const saveKey = async (v) => {
    await page.waitForSelector('#cfg-meridian-in', { state: 'visible', timeout: 20000 });
    await page.fill('#cfg-meridian-in', v);
    const [resp] = await Promise.all([page.waitForResponse((r) => /\/api\/reports\/config$/.test(r.url()) && r.request().method() === 'PUT'), page.click('#ap-meridian button:has-text("Save")')]);
    assert.strictEqual(resp.status(), 200);
    await page.waitForResponse((r) => /\/api\/reports\/config$/.test(r.url()) && r.request().method() === 'GET');   // the card reloads
  };
  assert.strictEqual(await callMeridian(OLD), 401, 'no key stored yet: refused');

  await saveKey(OLD);
  assert.ok(secrets.isEncrypted(await stored('meridian_in_key')) && !(await stored('meridian_in_key')).includes(OLD), 'stored as an encrypted box');
  assert.strictEqual(await callMeridian(OLD), 200, 'the stored key works');
  await j.measure(page, 'admin-meridian');

  // rotate
  await saveKey(NEW);
  assert.strictEqual(await callMeridian(OLD), 401, 'the OLD key no longer works');
  assert.strictEqual(await callMeridian(NEW), 200, 'the NEW key works');
  assert.strictEqual(await callMeridian(null), 401);
  // a blank re-save keeps the stored key
  const blank = await api(page, 'PUT', '/api/reports/config', { meridian_in_key: '' });
  assert.strictEqual(blank.status, 200);
  assert.strictEqual(await callMeridian(NEW), 200, 'blank = keep');

  // every secret-shaped setting is redacted: on GET and on the PUT answer
  const sp = await api(page, 'PUT', '/api/reports/config', { sharepoint_client_secret: SP });
  assert.strictEqual(sp.status, 200);
  const get = await api(page, 'GET', '/api/reports/config');
  assert.strictEqual(get.body.meridian_in_key, '');
  assert.strictEqual(get.body.sharepoint_client_secret, '', 'sharepoint_client_secret redacted on GET');
  const bodies = saw.concat([JSON.stringify(blank.body), JSON.stringify(sp.body), JSON.stringify(get.body)]);
  for (const v of [OLD, NEW, SP]) {
    assert.ok(!bodies.some((b) => b.includes(v)), 'a secret came back to the browser: ' + v.slice(0, 8) + '… in ' + (bodies.find((b) => b.includes(v)) || '').slice(0, 120));
    const n = await H.prepare("SELECT COUNT(*) AS n FROM system_log WHERE COALESCE(details::text,'') LIKE ? OR COALESCE(target,'') LIKE ?").get('%' + v + '%', '%' + v + '%');
    assert.strictEqual(Number(n.n), 0, 'a secret reached system_log');
    assert.ok(!(await H.prepare('SELECT string_agg(value, \'|\') AS v FROM report_config').get()).v.includes(v), 'plaintext at rest');
  }

  // dashboard API key: only for a valid session
  const KEY = process.env.DASHBOARD_API_KEY;
  assert.ok(KEY && KEY.length >= 16);
  assert.strictEqual(await page.evaluate(() => window.__ak), KEY, 'a signed-in page receives the key (the check below is meaningful)');
  for (const p of ['/', '/index.html', '/executive.html', '/analytics.html', '/reports.html', '/executive-report.html']) {
    const r = await raw(base, 'GET', p);
    assert.ok(!r.text.includes(KEY) && !/window\.__ak\s*=/.test(r.text), 'anonymous visitor got the API key on ' + p);
  }
  assert.strictEqual((await raw(base, 'GET', '/api/reports/sites')).status, 401, 'anonymous /api call refused');
  await world.setConfig({ meridian_in_key: '', sharepoint_client_secret: '' });
});
