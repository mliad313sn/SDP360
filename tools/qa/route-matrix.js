'use strict';
// M00/M02 — Route authorization matrix (development evidence, NOT certification).
// Boots the app in-process against the PostgreSQL database named by PG_URL (use a
// throwaway database — the probe creates a viewer account), with a temp data dir; enumerates every
// registered Express route (incl. nested routers), records its middleware chain,
// and probes each route as three anonymous-ish callers:
//   none    : no credentials at all
//   dashkey : only the x-dash-key header (the key injected into 5 HTML pages)
//   viewer  : a valid session for a plain 'viewer' account
// Writes JSON to argv[2] (default: stdout). Side effects stay in the temp dir.
const os = require('os'), fs = require('fs'), path = require('path'), http = require('http');
process.env.SDP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'route-matrix-'));
process.env.DASH_USER = 'rm-super'; process.env.DASH_PASS = 'rm-pass-0000-xyz';
process.env.DASHBOARD_API_KEY = 'rm-dash-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = 'dummy';
process.env.AI_PROVIDER = 'off';
process.env.SDP_TEST_NO_RATE_LIMIT = '1';

function collect(stack, prefix, out) {
  for (const l of stack) {
    if (l.route) {
      const names = l.route.stack.map((s) => (s.handle && s.handle.requiredRoles) ? `requireRole[${s.handle.requiredRoles.join('|')}]` : (s.name || 'anonymous'));
      for (const p of [].concat(l.route.path)) for (const m of Object.keys(l.route.methods))
        out.push({ method: m.toUpperCase(), path: prefix + p, chain: names });
    } else if (l.name === 'router' && l.handle && l.handle.stack) {
      collect(l.handle.stack, prefix, out);   // our routers are mounted at '/'
    }
  }
}
function concrete(p) {
  if (typeof p !== 'string') return null;
  return p.replace(/\(\.\*\)|\*/g, 'x').split('/').map((seg) => (seg.startsWith(':') ? (/id\b/i.test(seg) ? '1' : 'ZZZ') : seg)).join('/');
}
function call(base, method, p, headers) {
  return new Promise((resolve) => {
    const r = http.request(base + p, { method, headers: { 'content-type': 'application/json', ...headers }, timeout: 8000 },
      (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    r.on('timeout', () => { r.destroy(); resolve('timeout'); });
    r.on('error', () => resolve('error'));
    if (method !== 'GET' && method !== 'DELETE') r.write('{}');
    r.end();
  });
}

async function main() {
  const { app } = require('../../server');
  const rdb = require('../../reports-db');
  await rdb.initPgReports();
  for (const [m, f] of [['tracker-db', 'initPgTracker'], ['meetings-db', 'initPgMeetings'], ['inspection-db', 'initPgInspection'], ['assets-db', 'initPgAssets']])
    await require('../../' + m)[f]();
  await require('../../db/migrate').migrateAtBoot({ log: () => {} });
  await rdb.createUser({ username: 'rm-viewer', full_name: 'Viewer', password: 'rm-pass-1111-xyz', role: 'viewer' });
  const viewer = (await rdb.login('rm-viewer', 'rm-pass-1111-xyz')).token;
  const server = await new Promise((r) => { const s = http.createServer(app).listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const routes = []; collect(app._router.stack, '', routes);
  const rows = [];
  for (const rt of routes) {
    const p = concrete(rt.path);
    const row = { ...rt, probe: p };
    if (p && /^\/api\//.test(p) && rt.method !== 'HEAD') {
      row.none = await call(base, rt.method, p, {});
      row.dashkey = await call(base, rt.method, p, { 'x-dash-key': process.env.DASHBOARD_API_KEY });
      row.viewer = await call(base, rt.method, p, { 'x-report-token': viewer });
    }
    rows.push(row);
  }
  server.close();
  const json = JSON.stringify(rows, null, 1);
  if (process.argv[2]) fs.writeFileSync(process.argv[2], json); else process.stdout.write(json);
  process.exit(0);
}
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { collect, concrete };
