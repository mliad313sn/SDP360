'use strict';
const fetch = require('./_http-fetch');   // core-http shim (see tests/_http-fetch.js)
// Step 10 — /api/field/*: rights (field-tech on own site), bootstrap for offline work, resumable photo upload →
// offline inspection in the Inspections module, quick actions queue, pilot measures; the app page and its worker.
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_p.join(_os.tmpdir(), 'field-routes-'));
for (const k of ['REPORTS_BACKEND', 'ASSETS_BACKEND', 'TRACKER_BACKEND', 'MEETINGS_BACKEND', 'INSPECTION_BACKEND']) process.env[k] = 'sqlite';
process.env.DASH_USER = process.env.DASH_USER || 'fd-super';
process.env.DASH_PASS = process.env.DASH_PASS || 'fd-super-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'fd-key';
process.env.ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID || 'dummy';
process.env.ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET || 'dummy';
process.env.ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, rdb, tok = {}, mana;
const H = (t) => ({ 'Content-Type': 'application/json', 'x-report-token': t });
const get = (p, t) => fetch(base + p, { headers: H(t) });
const send = (m, p, t, body) => fetch(base + p, { method: m, headers: H(t), body: body ? JSON.stringify(body) : undefined });
const json = async (r) => ({ status: r.status, body: await r.json() });

before(async () => {
  const { app } = require('../server');
  rdb = require('../reports-db');
  mana = (await rdb.listSites()).find(s => s.name === 'MANA');
  const mk = async (u, roles, extra = {}) => {
    await rdb.createUser({ username: u, full_name: u, password: u + '-pass-0000', roles, ...extra });
    tok[u] = (await rdb.login(u, u + '-pass-0000')).token;
  };
  await mk('fd-viewer', ['viewer']);
  await mk('fd-tech', ['viewer', 'field-tech'], { site_id: mana.id });
  await mk('fd-nosite', ['viewer', 'field-tech']);
  await mk('fd-coord', ['editor'], { site_id: mana.id });
  await new Promise(r => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

test('bootstrap: field-tech on their site; viewer and site-less refused', async () => {
  assert.equal((await fetch(base + '/api/field/bootstrap')).status, 401);
  assert.equal((await get('/api/field/bootstrap', tok['fd-viewer'])).status, 403);
  assert.equal((await get('/api/field/bootstrap', tok['fd-nosite'])).status, 403);
  const b = await json(await get('/api/field/bootstrap', tok['fd-tech']));
  assert.equal(b.status, 200);
  assert.deepStrictEqual(b.body.user.sites, ['MGO']);
  assert.ok(b.body.inspection.categories.length >= 17);
  assert.equal(b.body.limits.photo_kb, 300);
  assert.equal(b.body.sdp_write, false);
  assert.equal(b.body.user.coordinator, false);
  assert.equal((await json(await get('/api/field/bootstrap', tok['fd-coord']))).body.user.coordinator, true);
});

test('a photo in chunks, then the inspection captured offline reaches the Inspections module', async () => {
  const jpeg = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(40000, 3)]);
  const id = 'ph-route-0001', parts = 2, size = Math.ceil(jpeg.length / parts);
  assert.equal((await send('POST', '/api/field/uploads', tok['fd-tech'], { id, mime: 'image/jpeg', size: jpeg.length, chunks: parts })).status, 201);
  await send('PUT', `/api/field/uploads/${id}/chunks/0`, tok['fd-tech'], { data: jpeg.slice(0, size).toString('base64') });
  assert.deepStrictEqual((await json(await get(`/api/field/uploads/${id}`, tok['fd-tech']))).body.received, [0]);
  assert.equal((await send('POST', `/api/field/uploads/${id}/complete`, tok['fd-tech'])).status, 409, 'chunk 1 missing');
  await send('PUT', `/api/field/uploads/${id}/chunks/1`, tok['fd-tech'], { data: jpeg.slice(size).toString('base64') });
  assert.equal((await send('POST', `/api/field/uploads/${id}/complete`, tok['fd-tech'])).status, 200);
  assert.equal((await get(`/api/field/uploads/${id}`, tok['fd-coord'])).status, 403, 'someone else’s upload');
  const st = { meta: { f_id: 'FLD-route-0001', f_site: 'MANA (MGO)', f_date: '2026-10-20', f_type: 'Routine' }, items: { env__0: { status: 'major', notes: 'Clim', photos: [{ upload: id }] } }, actions: [{ desc: 'Réparer', priority: 'High' }], status: 'submitted' };
  assert.equal((await send('PUT', '/api/field/inspections/OTHER-ID', tok['fd-tech'], { state: st })).status, 400);
  const r = await json(await send('PUT', '/api/field/inspections/FLD-route-0001', tok['fd-tech'], { state: st, base_updated_at: null }));
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.status, 'submitted'); assert.equal(r.body.photos, 1);
  const full = require('../inspection-db').getInspection('FLD-route-0001');
  assert.equal(full.header.site_code, 'MGO'); assert.equal(full.photos.length, 1); assert.equal(full.actions[0].description, 'Réparer');
  const other = { ...st, meta: { ...st.meta, f_id: 'FLD-route-0002', f_site: 'Hounde (HGO)' }, items: {} };
  assert.equal((await send('PUT', '/api/field/inspections/FLD-route-0002', tok['fd-tech'], { state: other })).status, 403, 'another site');
  const log = await rdb.listSystemLog({ action: 'field_inspection_saved' });
  assert.ok((log.rows || log).some(x => x.actor === 'fd-tech'));
});

test('quick actions: queued for the coordinator of the site, done by hand; pilot measures recorded', async () => {
  const q = await json(await send('POST', '/api/field/quick-actions', tok['fd-tech'], { id: 'qa-route-0001', kind: 'sdp_ticket', site: 'MGO', subject: 'Clim salle serveur' }));
  assert.equal(q.status, 201); assert.equal(q.body.action.status, 'pending_manual');
  assert.equal((await send('POST', '/api/field/quick-actions', tok['fd-tech'], { id: 'qa-route-0001', kind: 'sdp_ticket', site: 'MGO', subject: 'Clim salle serveur' })).status, 200, 'duplicate');
  assert.equal((await send('POST', '/api/field/quick-actions', tok['fd-tech'], { id: 'qa-route-0002', kind: 'sdp_ticket', site: 'HGO', subject: 'x' })).status, 403);
  const list = await json(await get('/api/field/quick-actions?status=pending_manual', tok['fd-coord']));
  assert.equal(list.body.actions.length, 1);
  assert.equal((await send('POST', '/api/field/quick-actions/qa-route-0001/done', tok['fd-tech'], { note: 'x' })).status, 403, 'a technician does not close the queue');
  assert.equal((await json(await send('POST', '/api/field/quick-actions/qa-route-0001/done', tok['fd-coord'], { note: 'INC-9 créé' }))).body.action.status, 'done');
  const rep = await json(await send('POST', '/api/field/sync-report', tok['fd-tech'], { ops: [{ kind: 'inspection', ok: true, duration_ms: 42000, bytes: 3000000, photos: 10 }], low_bandwidth: true }));
  assert.equal(rep.body.recorded, 1);
});

test('the app page is strict, installable, and its worker is served', async () => {
  const page = await fetch(base + '/field.html');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
  const html = await page.text();
  assert.match(html, /<link rel="manifest" href="field.webmanifest">/, 'a stable manifest URL');
  assert.match(html, /src="field-app.js\?v=/, 'the app script is versioned (it versions its service worker)');
  const mf = await fetch(base + '/field.webmanifest');
  assert.equal((await mf.json()).start_url, '/field.html');
  assert.equal((await fetch(base + '/sw.js')).status, 200);
});
