'use strict';
const fetch = require('./_http-fetch');
// P11 round 3 N-R3-3 — hostile path parameters on the monthly / yearly / objectives / weekly-summary report routes
// answered 500 ("Invalid time value", 22P02 'NaN'). A malformed site id, year, month or week is a client error: 400,
// before any database call; a well-formed request is unchanged.
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_p.join(_os.tmpdir(), 'report-params-'));
process.env.DASH_USER = process.env.DASH_USER || 'report-params-super';
process.env.DASH_PASS = process.env.DASH_PASS || 'report-params-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'report-params-key';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, site, tok;
const req = (method, path) => fetch(base + path, { method, headers: { 'x-report-token': tok, 'content-type': 'application/json' }, body: method === 'POST' ? '{}' : undefined });

before(async () => {
  const { app } = require('../server');
  const rdb = require('../reports-db');
  site = (await rdb.listSites())[0];
  await rdb.createUser({ username: 'rp-admin', full_name: 'rp-admin', password: 'rp-admin-0000', roles: ['super_admin'], site_id: null });
  tok = (await rdb.login('rp-admin', 'rp-admin-0000')).token;
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch (_) { /* closed */ } });

const ROUTES = [
  ['GET', 'monthly/{s}/{y}/{m}'], ['GET', 'monthly/{s}/{y}/{m}/edits'], ['POST', 'monthly/{s}/{y}/{m}/edits'],
  ['GET', 'monthly/{s}/{y}/{m}/pptx'], ['GET', 'monthly/{s}/{y}/{m}/pptx-v2'], ['GET', 'monthly/{s}/{y}/{m}/site-template/pptx'],
  ['GET', 'yearly/{s}/{y}'], ['GET', 'objectives/{s}/{y}'], ['POST', 'objectives/{s}/{y}'],
  ['GET', 'monthly/all-sites/{y}/{m}/pptx'], ['GET', 'weekly-summary/{y}/{w}/pptx'],
];
const fill = (t, o) => '/api/reports/' + t.replace('{s}', o.s).replace('{y}', o.y).replace('{m}', o.m).replace('{w}', o.w);

test('N-R3-3: malformed site / year / month / week → 400, never 500', async () => {
  const good = { s: site.id, y: '2026', m: '9', w: '30' };
  const bads = [{ y: 'ZZZ' }, { y: '0' }, { y: '99999' }, { m: 'ZZZ' }, { m: '13' }, { m: '0' }, { w: 'ZZZ' }, { w: '54' }, { s: 'ZZZ' }, { s: '-1' }, { s: '1.5' }];
  for (const [method, t] of ROUTES) {
    for (const b of bads) {
      const o = { ...good, ...b };
      if (fill(t, o) === fill(t, good)) continue;   // that parameter is not in this route
      const r = await req(method, fill(t, o));
      assert.equal(r.status, 400, `${method} ${fill(t, o)} → ${r.status}`);
    }
  }
});

test('N-R3-3: a well-formed monthly / yearly / objectives read still answers 200', async () => {
  for (const t of ['monthly/{s}/{y}/{m}', 'monthly/{s}/{y}/{m}/edits', 'yearly/{s}/{y}', 'objectives/{s}/{y}']) {
    const r = await req('GET', fill(t, { s: site.id, y: '2026', m: '9', w: '30' }));
    assert.equal(r.status, 200, t);
  }
});
