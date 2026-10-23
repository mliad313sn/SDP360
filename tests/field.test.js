'use strict';
// Step 10 — field app server side: resumable uploads, offline inspection save (idempotent, conflicts, stored photos,
// forged refs), quick actions (queue, idempotency, armed writer), SDP write adapter, replica watch, service worker scope.
process.env.REPORTS_BACKEND = 'sqlite';
process.env.INSPECTION_BACKEND = 'sqlite';
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_p.join(_os.tmpdir(), 'field-'));
process.env.DASH_USER = process.env.DASH_USER || 'fd-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'fd-admin-pass-0000';
const test = require('node:test');
const assert = require('node:assert');
const uploads = require('../services/field/uploads');
const fins = require('../services/field/inspections');
const quick = require('../services/field/quickActions');
const { makeSdpWriter } = require('../services/field/sdpWriter');
const replica = require('../services/replica');
const idb = require('../inspection-db');

const JPEG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(5000, 7)]);
async function sendPhoto(id, user, buf = JPEG, parts = 2) {
  await uploads.begin({ id, mime: 'image/jpeg', size: buf.length, chunks: parts }, user);
  const size = Math.ceil(buf.length / parts);
  for (let i = 0; i < parts; i++) await uploads.putChunk(id, i, buf.slice(i * size, (i + 1) * size).toString('base64'), user);
  return uploads.complete(id, user);
}

test('uploads: idempotent begin and chunks, resume, checks at completion, owner only', async () => {
  await uploads.begin({ id: 'up-0001-abcd', mime: 'image/jpeg', size: JPEG.length, chunks: 2 }, 'tech');
  await uploads.begin({ id: 'up-0001-abcd', mime: 'image/jpeg', size: JPEG.length, chunks: 2 }, 'tech');
  await assert.rejects(uploads.begin({ id: 'up-0001-abcd', mime: 'image/jpeg', size: 10, chunks: 1 }, 'other'), /someone else/);
  await assert.rejects(uploads.begin({ id: 'up-0002-abcd', mime: 'image/gif', size: 10, chunks: 1 }, 'tech'), /JPEG, PNG or WebP/);
  await assert.rejects(uploads.begin({ id: 'up-0003-abcd', mime: 'image/jpeg', size: 400 * 1024, chunks: 4 }, 'tech'), /300 KB/);
  const half = Math.ceil(JPEG.length / 2);
  await uploads.putChunk('up-0001-abcd', 1, JPEG.slice(half).toString('base64'), 'tech');
  assert.deepStrictEqual((await uploads.status('up-0001-abcd', 'tech')).received, [1], 'resume: chunk 0 is missing');
  assert.deepStrictEqual(await uploads.complete('up-0001-abcd', 'tech'), { ok: false, missing: [0] });
  await uploads.putChunk('up-0001-abcd', 0, JPEG.slice(0, half).toString('base64'), 'tech');
  await uploads.putChunk('up-0001-abcd', 0, JPEG.slice(0, half).toString('base64'), 'tech');
  assert.deepStrictEqual(await uploads.complete('up-0001-abcd', 'tech'), { ok: true });
  assert.deepStrictEqual(await uploads.complete('up-0001-abcd', 'tech'), { ok: true }, 'complete twice');
  assert.match(await uploads.dataUrl('up-0001-abcd', 'tech'), /^data:image\/jpeg;base64,\/9j\//);
  assert.equal(await uploads.dataUrl('up-0001-abcd', 'other'), null);
  await uploads.begin({ id: 'up-0004-abcd', mime: 'image/png', size: JPEG.length, chunks: 1 }, 'tech');
  await uploads.putChunk('up-0004-abcd', 0, JPEG.toString('base64'), 'tech');
  await assert.rejects(uploads.complete('up-0004-abcd', 'tech'), /not the announced image type/);
});

const state = (id, extra) => ({ meta: { f_id: id, f_site: 'MANA (MGO)', f_date: '2026-10-20', f_type: 'Routine', f_inspector: 'Ali' }, items: {}, actions: [], status: 'draft', ...extra });

test('offline inspection: created once, retry after a lost answer, photos kept on the next save, forged refs ignored', async () => {
  await sendPhoto('ph-0001-abcd', 'tech');
  const st = state('FLD-0001-abcdef', { items: { env__0: { status: 'major', notes: 'Clim en panne', photos: [{ upload: 'ph-0001-abcd' }] } } });
  const opts = { username: 'tech', userId: 1, userCodes: ['MGO'], base_updated_at: null, inspectionDb: idb };
  const a = await fins.save(JSON.parse(JSON.stringify(st)), opts);
  assert.equal(a.status, 200); assert.equal(a.body.created, true); assert.equal(a.body.photos, 1);
  const ref = a.body.stored_photos.env__0[0].__blob;
  assert.ok(ref);
  // The answer was lost: the phone resends the SAME payload with its old base → no conflict, no duplicate, photo kept.
  const b = await fins.save(JSON.parse(JSON.stringify(st)), opts);
  assert.equal(b.status, 200); assert.equal(b.body.created, false);
  assert.equal(b.body.stored_photos.env__0.length, 1);
  // Next save from the phone carries the stored ref (+ a forged one from elsewhere), status submitted.
  const next = state('FLD-0001-abcdef', { status: 'submitted', items: { env__0: { status: 'major', photos: [{ __blob: ref }, { __blob: 'inspection/OTHER/env__0-0' }] } } });
  const c = await fins.save(next, { ...opts, base_updated_at: b.body.updated_at });
  assert.equal(c.status, 200);
  assert.deepStrictEqual(c.body.stored_photos.env__0.map(x => x.__blob), [ref], 'kept, the forged ref is dropped');
  assert.equal((await idb.getInspectionHeader('FLD-0001-abcdef')).status, 'submitted');
  const full = idb.getInspection('FLD-0001-abcdef');
  assert.equal(full.photos.length, 1); assert.ok(full.photos[0].data_b64.length > 100);
  assert.equal(full.findings[0].notes, null, 'the latest state wins');
});

test('offline inspection: conflict when changed elsewhere, force keeps the phone version, other site refused', async () => {
  const opts = { username: 'tech', userId: 1, userCodes: ['MGO'], inspectionDb: idb };
  const a = await fins.save(state('FLD-0002-abcdef'), { ...opts, base_updated_at: null });
  // Someone edits it in the full form (a save that is not this phone's).
  await new Promise(r => setTimeout(r, 1100));
  idb.saveInspection(state('FLD-0002-abcdef', { items: { env__1: { status: 'ok' } } }), ['MGO'], 2);
  const c = await fins.save(state('FLD-0002-abcdef'), { ...opts, base_updated_at: a.body.updated_at });
  assert.equal(c.status, 409); assert.match(c.body.error, /changed since/);
  const f = await fins.save(state('FLD-0002-abcdef'), { ...opts, base_updated_at: a.body.updated_at, force: true });
  assert.equal(f.status, 200);
  await assert.rejects(fins.save(state('FLD-0003-abcdef'), { ...opts, userCodes: ['HGO'], base_updated_at: null }), /Cross-site/);
  const m = await fins.save(state('FLD-0004-abcdef', { items: { env__0: { photos: [{ upload: 'never-sent-0001' }] } } }), { ...opts, base_updated_at: null });
  assert.equal(m.status, 409); assert.deepStrictEqual(m.body.missing, ['env__0:never-sent-0001']);
});

test('quick actions: validation, queued while SDP write is off, idempotent, armed writer', async () => {
  assert.match(quick.validate({ id: 'x', kind: 'sdp_close' }).errors.join(' '), /id:.*ticket_id.*justification/);
  const v = quick.validate({ id: 'qa-0001-abcd', kind: 'sdp_ticket', site: 'mgo', subject: 'Clim en panne', description: 'salle serveur' });
  assert.ok(v.ok); assert.equal(v.action.payload.site, 'MGO');
  const off = makeSdpWriter({ enabled: false });
  const r1 = await quick.submit(v.action, 'tech', off);
  assert.equal(r1.action.status, 'pending_manual');
  assert.equal((await quick.submit(v.action, 'tech', off)).duplicate, true, 'the same id twice is the same action');
  assert.equal((await quick.markDone('qa-0001-abcd', 'coord', 'INC-123 créé')).status, 'done');
  const calls = [];
  const transport = { post: async (url, body) => { calls.push(url); return url.includes('/oauth/') ? { data: { access_token: 'tok', expires_in: 3600 } } : { data: { request: { display_id: '4242' } } }; }, put: async (url) => { calls.push(url); return { data: {} }; } };
  const on = makeSdpWriter({ enabled: true, baseUrl: 'https://sdp.example/app/itdesk/api/v3', clientId: 'c', clientSecret: 's', refreshToken: 'r', transport });
  const r2 = await quick.submit(quick.validate({ id: 'qa-0002-abcd', kind: 'sdp_ticket', site: 'MGO', subject: 'x' }).action, 'tech', on);
  assert.equal(r2.action.status, 'done'); assert.match(r2.action.result, /4242/);
  assert.deepStrictEqual(calls.filter(u => !u.includes('oauth')), ['https://sdp.example/app/itdesk/api/v3/requests'], 'base URL already ends with /api/v3');
  const t = await on.perform(quick.validate({ id: 'qa-0003-abcd', kind: 'sdp_transfer', ticket_id: '77', justification: 'réseau', target_group: 'Réseau MGO' }).action);
  assert.equal(t.ok, true); assert.ok(calls.includes('https://sdp.example/app/itdesk/api/v3/requests/77'));
  const fail = makeSdpWriter({ enabled: true, baseUrl: 'https://x', clientId: 'c', clientSecret: 's', refreshToken: 'r', transport: { post: async () => { throw Object.assign(new Error('x'), { response: { status: 401 } }); } } });
  const r3 = await quick.submit(quick.validate({ id: 'qa-0004-abcd', kind: 'sdp_ticket', subject: 'y' }).action, 'tech', fail);
  assert.equal(r3.action.status, 'pending_manual', 'a refused write falls back to the manual queue'); assert.match(r3.action.result, /HTTP 401/);
});

test('replica watch: skipped without replica, lag within / beyond the objective, promoted replica', async () => {
  assert.ok((await replica.check({ env: {} })).skipped);
  const fake = (row) => async () => ({ query: async () => ({ rows: [row] }), end: async () => {} });
  const ok = await replica.check({ env: { PG_REPLICA_URL: 'postgres://r' }, connect: fake({ in_recovery: true, caught_up: false, age_s: 120 }) });
  assert.equal(ok.lag_seconds, 120); assert.equal(ok.error, undefined);
  assert.equal((await replica.check({ env: { PG_REPLICA_URL: 'postgres://r' }, connect: fake({ in_recovery: true, caught_up: true, age_s: 99999 }) })).lag_seconds, 0, 'caught up = no lag');
  assert.match((await replica.check({ env: { PG_REPLICA_URL: 'postgres://r' }, connect: fake({ in_recovery: true, caught_up: false, age_s: 3600 }) })).error, /60 min behind/);
  assert.match((await replica.check({ env: { PG_REPLICA_URL: 'postgres://r' }, connect: fake({ in_recovery: false, caught_up: true, age_s: 0 }) })).error, /promoted/);
  const down = await replica.check({ env: { PG_REPLICA_URL: 'postgres://user:secret@host/db' }, connect: async () => { throw new Error('connect to postgres://user:secret@host/db failed'); } });
  assert.ok(!down.error.includes('secret'), 'the connection string never reaches the run log');
});

test('pilot measures: 10-photo send durations, failures, NPS', () => {
  const { summarise, npsFromCsv } = require('../tools/metrics/field-pilot');
  const rows = [
    { details: JSON.stringify({ low_bandwidth: true, ops: [{ kind: 'inspection', ok: true, photos: 10, duration_ms: 90000, queued_ms: 600000 }, { kind: 'inspection', ok: false, photos: 12, duration_ms: 5000 }] }) },
    { details: { ops: [{ kind: 'inspection', ok: true, photos: 12, duration_ms: 150000, queued_ms: 0 }, { kind: 'quick', ok: true, photos: 0, duration_ms: 400, queued_ms: 0 }] } },
  ];
  const s = summarise(rows);
  assert.equal(s.sends, 4); assert.equal(s.failed_attempts, 1); assert.equal(s.inspections, 2);
  assert.deepStrictEqual([s.ten_photo_sends.count, s.ten_photo_sends.within_target, s.ten_photo_sends.median_seconds], [2, 1, 120]);
  assert.equal(s.low_bandwidth_share, 50);
  assert.deepStrictEqual(npsFromCsv('note\n10\n9\n7\n3\n'), { n: 4, nps: 25 });
  assert.deepStrictEqual(npsFromCsv(''), { n: 0, nps: null });
});

test('service worker: caches only the field app, never an API call', () => {
  const sw = require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'sw.js'), 'utf8');
  assert.match(sw, /url\.pathname\.indexOf\('\/api\/'\) === 0\) return false/);
  assert.match(sw, /new URL\(req\.referrer\)\.pathname === '\/field\.html'/);
  assert.match(sw, /if \(!isFieldRequest\(req\)\) return;/);
});
