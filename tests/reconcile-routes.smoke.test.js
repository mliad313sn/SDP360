'use strict';
const fetch = require('./_http-fetch');   // core-http shim — undici keep-alive aborts the process at --test-force-exit on Windows
// Reconciliation routes smoke — the /api/assets/reconcile/* block.
// Boots the express app IN-PROCESS (start() is guarded by require.main → no port
// bind). Backends pinned to sqlite. Run with --test-force-exit (top-level cron
// keeps the loop alive).
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'reconcile-smoke-'));
process.env.ASSETS_BACKEND = 'sqlite';
process.env.REPORTS_BACKEND = 'sqlite';
process.env.DASH_USER = process.env.DASH_USER || 'reconcile-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'reconcile-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'reconcile-key';
process.env.ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID || 'dummy';
process.env.ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET || 'dummy';
process.env.ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, adminToken, viewerToken;

const AD_CSV = 'name,dNSHostName,operatingSystem,lastLogonTimestamp,distinguishedName,enabled\r\n'
  + 'PC-01,PC-01.edv-ops.com,Windows 11 Pro,__RECENT__,"CN=PC-01,OU=Computers,OU=Mana,DC=edv-ops,DC=com",True\r\n'
  + 'PC-99,PC-99.edv-ops.com,Windows 11 Pro,__RECENT__,"CN=PC-99,OU=Computers,OU=Mana,DC=edv-ops,DC=com",True\r\n';

const adCsv = () => AD_CSV.replace(/__RECENT__/g, new Date(Date.now() - 2 * 86400000).toISOString());

before(async () => {
  const { app } = require('../server');
  const rdb = require('../reports-db');
  const adb = require('../assets-db');

  // PC-01 est dans SDP, PC-99 non → exactement un ecart attendu.
  adb.replaceTable('assets',
    ['asset_id', 'asset_name', 'site', 'state', 'product_type', 'manufacturer', 'serial_number'],
    [{ asset_id: 'A1', asset_name: 'PC-01', site: 'MANA', state: 'In Use',
       product_type: 'Workstation', manufacturer: 'Dell', serial_number: 'SN-1' }]);

  const me = (rdb.listUsers() || []).find(u => u.username === process.env.DASH_USER);
  assert.ok(me, 'seeded admin user exists');
  rdb.setUserRoles(me.id, ['admin']);
  adminToken = (await rdb.login(process.env.DASH_USER, process.env.DASH_PASS)).token;

  // full_name est NOT NULL dans le schema users — l'omettre fait echouer le
  // hook avant, et TOUS les tests tombent sur la meme contrainte.
  rdb.createUser({ username: 'reconcile-viewer', full_name: 'Lecteur Reconciliation',
    password: 'reconcile-viewer-0000', roles: ['viewer'] });
  viewerToken = (await rdb.login('reconcile-viewer', 'reconcile-viewer-0000')).token;

  await new Promise(r => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

const auth = (t) => ({ 'x-report-token': t || adminToken });
const csvPost = (t) => ({ 'x-report-token': t || adminToken, 'content-type': 'text/csv' });

// ── Garde d'acces ───────────────────────────────────────────────────────────
test('sans session -> refus, jamais 200', async () => {
  const res = await fetch(base + '/api/assets/reconcile/summary');
  assert.ok(res.status === 401 || res.status === 403, `attendu 401/403, recu ${res.status}`);
});

test('un lecteur ne peut PAS importer', async () => {
  // L'import remplace une source entiere. Le laisser a un lecteur permettrait
  // de vider le rapport de tout le monde.
  const res = await fetch(base + '/api/assets/reconcile/import?source=ad', {
    method: 'POST', headers: csvPost(viewerToken), body: adCsv(),
  });
  assert.equal(res.status, 403, `attendu 403, recu ${res.status}`);
});

// ── Previsualisation et import ──────────────────────────────────────────────
test('la previsualisation ne persiste RIEN', async () => {
  const before_ = await (await fetch(base + '/api/assets/reconcile/summary', { headers: auth() })).json();
  const res = await fetch(base + '/api/assets/reconcile/preview?source=ad', {
    method: 'POST', headers: csvPost(), body: adCsv(),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.rows, 2, 'les deux lignes sont lues');
  const after_ = await (await fetch(base + '/api/assets/reconcile/summary', { headers: auth() })).json();
  assert.equal(after_.counts.external_total, before_.counts.external_total, 'rien n a ete ecrit');
});

test('un CSV sans la colonne requise -> 400 qui NOMME la colonne, jamais 500', async () => {
  const res = await fetch(base + '/api/assets/reconcile/preview?source=ad', {
    method: 'POST', headers: csvPost(), body: 'operatingSystem,enabled\r\nWindows 11,True\r\n',
  });
  assert.equal(res.status, 400, `attendu 400, recu ${res.status}`);
  const body = await res.json();
  assert.match(String(body.error || ''), /name/, 'le message nomme la colonne absente');
  assert.equal(body.column, 'name');
});

test('une source inconnue -> 400, jamais un import silencieux sous un mauvais nom', async () => {
  const res = await fetch(base + '/api/assets/reconcile/preview?source=sharepoint', {
    method: 'POST', headers: csvPost(), body: adCsv(),
  });
  assert.equal(res.status, 400, `attendu 400, recu ${res.status}`);
});

test('l import ecrit, et le resume voit l ecart', async () => {
  const res = await fetch(base + '/api/assets/reconcile/import?source=ad', {
    method: 'POST', headers: csvPost(), body: adCsv(),
  });
  assert.equal(res.status, 200, `attendu 200, recu ${res.status}`);
  const body = await res.json();
  assert.equal(body.imported, 2);

  const sum = await (await fetch(base + '/api/assets/reconcile/summary', { headers: auth() })).json();
  assert.equal(sum.counts.gaps, 1, 'PC-99 est l ecart, PC-01 est inventorie');
  assert.ok(Array.isArray(sum.by_site) && Array.isArray(sum.by_ou));
  assert.ok(sum.window && sum.window.as_of, 'la fenetre accompagne toujours le chiffre');
  // Le retrait est applicable des qu une source datee est presente.
  assert.equal(sum.counts.retirement_applicable, true);
  assert.deepStrictEqual(sum.counts.sources_present, ['ad']);
});

test('l import laisse une trace dans le journal ET capture un point de courbe', async () => {
  // L'import precedent a deja ecrit ; on verifie que /history voit les deux.
  const res = await fetch(base + '/api/assets/reconcile/history', { headers: auth() });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.points) && body.points.length >= 1, 'au moins un point de courbe');
  assert.ok(Array.isArray(body.imports) && body.imports.some((i) => i.source === 'ad'), 'le journal porte l import AD');
  const ad = body.imports.find((i) => i.source === 'ad');
  assert.ok(ad.row_count >= 2, 'le nombre de lignes est trace');
  const pt = body.points[body.points.length - 1];
  assert.ok('gaps_open' in pt && 'retirement_candidates' in pt, 'le point porte les compteurs');
});

test('la capture manuelle est reservee aux admins', async () => {
  const res = await fetch(base + '/api/assets/reconcile/snapshot', { method: 'POST', headers: auth(viewerToken) });
  assert.equal(res.status, 403, `attendu 403, recu ${res.status}`);
});

test('l export porte une feuille Synthese en tete + les trois feuilles de detail', async () => {
  const res = await fetch(base + '/api/assets/reconcile/export.xlsx', { headers: auth() });
  assert.equal(res.status, 200);
  const buf = Buffer.from(await res.arrayBuffer());
  // Un .xlsx est un zip : signature 'PK'. On confirme le fichier bien forme,
  // puis on lit les noms de feuilles avec le meme SheetJS que la route.
  assert.equal(buf[0], 0x50); assert.equal(buf[1], 0x4B);
  const XLSX = require('xlsx');
  const wb = XLSX.read(buf, { type: 'buffer' });
  assert.deepStrictEqual(wb.SheetNames, ['Synthèse', 'Écarts', 'Par OU', 'Candidats au retrait', 'À vérifier']);
});

test('la liste de retrait triee expose le detail des ecartes + retirement_review', async () => {
  const s = await (await fetch(base + '/api/assets/reconcile/summary', { headers: auth() })).json();
  for (const k of ['retirement_excluded_renamed', 'retirement_excluded_off_network', 'retirement_excluded_never_scanned']) {
    assert.ok(k in s.counts, k + ' present dans les compteurs');
  }
  const g = await (await fetch(base + '/api/assets/reconcile/gaps', { headers: auth() })).json();
  assert.ok(Array.isArray(g.retirement_review), 'la liste "a verifier" accompagne les candidats');
});

test('les ecarts sont listables et portent site + type + leurs sources', async () => {
  const res = await fetch(base + '/api/assets/reconcile/gaps', { headers: auth() });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.gaps.length, 1);
  const g = body.gaps[0];
  assert.equal(g.device_name, 'PC-99');
  assert.ok('site' in g && 'site_source' in g, 'le site vient toujours avec sa provenance');
  assert.ok('type' in g && 'type_source' in g);
});

// ── Parametres hostiles ─────────────────────────────────────────────────────
test('un asOf malformant -> 200, jamais 500', async () => {
  for (const q of ['?asOf=../../etc/passwd', "?asOf=' OR 1=1--", '?asOf=abc', '?recentDays=-5', '?recentDays=abc']) {
    const res = await fetch(base + '/api/assets/reconcile/summary' + q, { headers: auth() });
    assert.equal(res.status, 200, `${q} a rendu ${res.status}`);
  }
});

test('asOf est resolu EN HAUT du handler et renvoye — pas seulement dans l etiquette', async () => {
  // Le piege documente de la depreciation : asOf correct dans l enveloppe de
  // reponse, undefined passe au lecteur. Ici asOf pilote la fenetre de
  // fraicheur : passe undefined, tout devient "jamais vu".
  const res = await fetch(base + '/api/assets/reconcile/summary?asOf=2020-01-01', { headers: auth() });
  const body = await res.json();
  assert.equal(body.window.as_of, '2020-01-01');
  assert.equal(body.counts.gaps, 0, 'en 2020 la machine de 2026 n est pas encore apparue');
});

// ── Decisions ───────────────────────────────────────────────────────────────
test('hors-perimetre sans motif -> 400', async () => {
  const res = await fetch(base + '/api/assets/reconcile/decision', {
    method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, auth()),
    body: JSON.stringify({ device_key: 'PC-99', decision: 'out_of_scope', reason: '' }),
  });
  assert.equal(res.status, 400, `attendu 400, recu ${res.status}`);
});

test('une decision retire la machine du compteur a traiter sans la faire disparaitre', async () => {
  const res = await fetch(base + '/api/assets/reconcile/decision', {
    method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, auth()),
    body: JSON.stringify({ device_key: 'PC-99', decision: 'out_of_scope', reason: 'poste de pret' }),
  });
  assert.equal(res.status, 200, `attendu 200, recu ${res.status}`);
  const sum = await (await fetch(base + '/api/assets/reconcile/summary', { headers: auth() })).json();
  assert.equal(sum.counts.gaps_open, 0);
  assert.equal(sum.counts.gaps, 1, 'le total brut reste affiche');
});

// ── Le collecteur ───────────────────────────────────────────────────────────
test('le collecteur .ps1 est servi en piece jointe', async () => {
  const res = await fetch(base + '/api/assets/reconcile/collector.ps1', { headers: auth() });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition') || '', /attachment/);
  const txt = await res.text();
  assert.match(txt, /DirectorySearcher/, 'c est bien le collecteur');
});

test('la requete KQL Defender est servie elle aussi', async () => {
  const res = await fetch(base + '/api/assets/reconcile/defender.kql', { headers: auth() });
  assert.equal(res.status, 200);
  assert.match(await res.text(), /DeviceInfo/);
});
