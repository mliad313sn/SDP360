'use strict';
// F1 Task A3 — GET /api/actions/open smoke. Boots the app in-process, sets the
// inbound key in report_config, seeds one meetings action, and asserts the C2 shape.
// The route is authed by its OWN X-API-Key (meridian_in_key), exempt from the global
// /api/ dash-key gate. Backends pinned sqlite. Run with --test-force-exit.
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'meridian-smoke-'));
process.env.DASH_USER = process.env.DASH_USER || 'meridian-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'meridian-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'meridian-key';
process.env.ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID || 'dummy';
process.env.ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET || 'dummy';
process.env.ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

const IN_KEY = 'meridian-inbound-secret';
let server, base;

function get(path, apiKey) {
  return new Promise((resolve, reject) => {
    const headers = apiKey === undefined ? {} : { 'X-API-Key': apiKey };
    const req = http.get(base + path, { headers }, (res) => {
      let b = ''; res.on('data', (d) => (b += d));
      res.on('end', () => resolve({ status: res.statusCode, body: b ? JSON.parse(b) : null }));
    });
    req.on('error', reject);
  });
}

before(async () => {
  const { app } = require('../server');
  const rdb = require('../reports-db');
  const mdb = require('../meetings-db');
  const reportConfig = require('../services/reportConfig');

  // Arm the inbound key.
  (await reportConfig.setConfig(rdb.db, { meridian_in_key: IN_KEY }, 'test'));

  // Seed one non-closed meetings action for site MGO.
  const db = mdb.getDB();
  const m = (await db.prepare("INSERT INTO md_meetings (reference, site_code, department, meeting_date, status) VALUES ('MGO_Mer_2026-07','MGO','Technical Services','2026-07-01','signed')").run());
  (await db.prepare("INSERT INTO md_actions (meeting_id, description, owner_it, target_date, status, created_at) VALUES (?,?,?,?,?,?)")
    .run(m.lastID, 'Fix VSAT', 'Ousmane', '2026-07-01', 'open', '2026-06-27T00:00:00Z'));

  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

test('no X-API-Key → 401', async () => {
  const r = await get('/api/actions/open?site=MGO', undefined);
  assert.equal(r.status, 401);
});

test('wrong key → 401', async () => {
  const r = await get('/api/actions/open?site=MGO', 'nope');
  assert.equal(r.status, 401);
});

test('correct key → 200, C2 shape, seeded action present, PII-safe', async () => {
  const r = await get('/api/actions/open?site=MGO', IN_KEY);
  assert.equal(r.status, 200);
  assert.equal(r.body.site, 'MGO');
  assert.ok(typeof r.body.as_of === 'string');
  assert.ok(Array.isArray(r.body.actions));
  const a = r.body.actions.find((x) => x.title === 'Fix VSAT');
  assert.ok(a, 'seeded meetings action flows through');
  assert.match(a.id, /^meetings:\d+$/, 'stable id');
  // PII-safe: no requester/technician keys leak.
  for (const x of r.body.actions) {
    assert.ok(!('requester' in x) && !('technician' in x), 'no PII keys');
  }
});

test('unknown site → 200 empty actions, not 500', async () => {
  const r = await get('/api/actions/open?site=ZZZ_NOPE', IN_KEY);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.actions, []);
});
