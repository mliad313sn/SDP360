'use strict';
// E-F02 — the field queue on constrained networks: no silent loss. One journey, seven cases, French UI:
//   (a) 800 ms latency + 3 offline/online flaps during a sync      (e) chunk failure mid-upload → only the missing chunks again
//   (b) captive portal: /api/field/* answered 200 text/html         (f) user A queues, user B signs in → A's entries not sent
//   (c) session expiry (401) in the middle of a photo upload        (g) storage quota failure + page reload → earlier entry intact
//   (d) 409 in_progress, then success
// SIMULATED network (Chromium DevTools protocol + route stubs) — not a real VSAT / 4G link. The field sign-off on
// real phones stays a human gate (docs/ops/pilot/FIELD-DEVICE-UAT.md, E-F04).
const assert = require('node:assert');
const crypto = require('crypto');
const zlib = require('zlib');
const { runJourney } = require('./fixtures/harness');
const { netConditions } = require('./fixtures/browser');

// PNG built here (no binary fixture): `noise` makes the compressed JPEG big enough for several 64 KB chunks
function png(w, h, noise) {
  const crc = (b) => { let c, k; const t = []; for (let n = 0; n < 256; n++) { c = n; for (k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } c = 0xFFFFFFFF; for (const x of b) c = t[(c ^ x) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = noise ? crypto.randomBytes((w * 3 + 1) * h) : Buffer.alloc((w * 3 + 1) * h, 120);
  for (let y = 0; y < h; y++) raw[y * (w * 3 + 1)] = 0;   // filter byte
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const BIG = () => ({ name: 'rack.png', mimeType: 'image/png', buffer: png(600, 400, true) });

runJourney('F1 field queue on constrained networks (latency, flaps, captive portal, 401, 409, chunks, user switch, quota)', async ({ world, browser, j, login }) => {
  const ctx = await j.newContext(browser);
  const reqs = [];   // every field API request of the context: method + path
  ctx.on('request', (r) => { const u = new URL(r.url()); if (u.pathname.startsWith('/api/field/')) reqs.push(r.method() + ' ' + u.pathname); });
  let page = await ctx.newPage();
  await login(page, world.users.tech, '/field/index.html');
  const ready = async (p) => { await p.waitForFunction(() => { const s = document.getElementById('site'); return s && s.options.length > 0; }, null, { timeout: 20000 }); };
  await ready(page);
  await j.measure(page, 'field');
  const fieldMsg = () => page.textContent('#msg');
  const queueCount = async () => Number(await page.textContent('#queue'));
  const waitQueue = (n, ms = 15000) => page.waitForFunction((x) => document.getElementById('queue').textContent === String(x), n, { timeout: ms })
    .catch(async () => { throw new Error(`queue never reached ${n} (now ${await page.textContent('#queue')}); message: ${await fieldMsg()}`); });
  const outboxText = () => page.textContent('#outbox-list');
  const home = () => page.click('nav.tabs button[data-view="home"]');
  async function syncUntilEmpty(ms = 60000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await queueCount() === 0) return;
      await home(); await page.click('#sync').catch(() => {});
      await page.waitForTimeout(1500);
    }
    throw new Error('outbox never emptied: ' + await outboxText() + ' · ' + await fieldMsg());
  }
  async function queueInsp(note, photo) {
    await page.click('nav.tabs button[data-view="inspect"]');
    await page.waitForSelector('#i-items button[data-ix]');
    await page.locator('#i-items button[data-st]').first().click();
    if (photo) {
      await page.setInputFiles('#i-photo', photo);
      await page.waitForFunction(() => document.querySelectorAll('#i-photos img').length === 1, null, { timeout: 10000 })
        .catch(async () => { throw new Error('photo not added: ' + await fieldMsg()); });
    }
    await page.fill('#i-notes', note);
    const before = await queueCount();
    await page.click('#i-save');
    await page.waitForFunction((n) => Number(document.getElementById('queue').textContent) >= n || /NON enregistr/.test(document.getElementById('msg').textContent), before + 1, { timeout: 10000 }).catch(() => {});
  }
  const outboxIds = () => page.evaluate(() => new Promise((res, rej) => { const r = indexedDB.open('field', 1); r.onsuccess = () => { const q = r.result.transaction('outbox').objectStore('outbox').getAll(); q.onsuccess = () => res(q.result.map((e) => ({ uuid: e.uuid, state: e.state, user: e.user, label: e.label }))); q.onerror = () => rej(q.error); }; r.onerror = () => rej(r.error); }));
  // inspections applied from the field, read through the server ledger (the list API carries no observations)
  const recCache = new Map();
  async function byNote(note) {
    const out = [];
    for (const row of await serverOutbox(world.users.tech)) {
      const id = row.status === 'applied' && row.kind === 'inspection' && row.result && row.result.inspection_id; if (!id) continue;
      if (!recCache.has(id)) recCache.set(id, (await world.call('GET', '/api/inspection/' + encodeURIComponent(id), world.users.edA.token)).j);
      const rec = recCache.get(id); const obs = rec && rec.header && rec.header.key_observations;
      if (obs === note) out.push({ id, rec });
    }
    return out;
  }
  const photosOf = (hit) => (hit.rec.photos || []).length;
  const serverOutbox = async (user) => ((await world.call('GET', '/api/field/outbox?limit=500', user.token)).j || {}).items || [];

  // ── (a) 800 ms latency + 3 flaps during the sync ─────────────────────────────────────────
  await ctx.setOffline(true);
  for (const n of [1, 2, 3]) await queueInsp('F1a-' + n, n === 2 ? BIG() : null);
  await waitQueue(3);
  const aIds = (await outboxIds()).map((e) => e.uuid);
  await ctx.setOffline(false);
  await netConditions(page, { latency: 800 });
  await home(); await page.click('#sync');
  for (let k = 0; k < 3; k++) {
    await page.waitForTimeout(700);
    await netConditions(page, { offline: true, latency: 800 });
    await page.waitForTimeout(400);
    await netConditions(page, { offline: false, latency: 800 });
  }
  await syncUntilEmpty(90000);
  await netConditions(page, { latency: 0 });
  const sa = await serverOutbox(world.users.tech);
  for (const id of aIds) assert.strictEqual((sa.find((x) => x.uuid === id) || {}).status, 'applied', '(a) entry applied: ' + id);
  for (const n of [1, 2, 3]) assert.strictEqual((await byNote('F1a-' + n)).length, 1, '(a) inspection F1a-' + n + ' stored exactly once');
  assert.strictEqual(photosOf((await byNote('F1a-2'))[0]), 1, '(a) one photo');

  // ── (b) captive portal: the network answers an HTML page ────────────────────────────────
  const portal = (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>Wi-Fi sign-in — accept the terms</body></html>' });
  await page.route('**/api/field/outbox/**', portal);
  await queueInsp('F1b');
  await page.waitForFunction(() => /page web/.test(document.getElementById('msg').textContent), null, { timeout: 15000 })
    .catch(async () => { throw new Error('(b) no captive-portal message; message: ' + await fieldMsg() + ' · outbox: ' + await outboxText()); });
  assert.strictEqual(await queueCount(), 1, '(b) entry kept');
  const bState = (await outboxIds())[0].state;
  assert.strictEqual(bState, 'failed', '(b) a portal page is a network failure (retried), not a refusal — got ' + bState);
  assert.match(await outboxText(), /nouvel essai prévu/, '(b) shown as "will retry" in French');
  await page.unroute('**/api/field/outbox/**', portal);
  await syncUntilEmpty();
  assert.strictEqual((await byNote('F1b')).length, 1, '(b) applied once after the portal is gone');

  // ── (c) session expiry (401) in the middle of a photo upload ────────────────────────────
  let cut = false;
  const expire = async (route) => { if (cut) return route.fallback(); cut = true; await ctx.clearCookies(); return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'session expired' }) }); };
  await page.route('**/api/field/uploads/*/chunks/*', expire);
  const reqMark = reqs.length;
  await queueInsp('F1c', BIG());
  await page.waitForFunction(() => /Session expirée/.test(document.getElementById('msg').textContent), null, { timeout: 15000 })
    .catch(async () => { throw new Error('(c) no session-expired message: ' + await fieldMsg()); });
  assert.strictEqual(await queueCount(), 1, '(c) entry kept on the phone');
  assert.ok(!reqs.slice(reqMark).some((r) => /^PUT \/api\/field\/outbox\//.test(r)), '(c) the sync stopped before the inspection envelope');
  await page.unroute('**/api/field/uploads/*/chunks/*', expire);
  await page.close();
  page = await ctx.newPage();
  await login(page, world.users.tech, '/field/index.html');
  await ready(page);
  await syncUntilEmpty();
  const cReqs = reqs.slice(reqMark);
  assert.strictEqual(cReqs.filter((r) => r === 'POST /api/field/uploads').length, 1, '(c) one upload opened, resumed after sign-in');
  const c1 = (await byNote('F1c'));
  assert.strictEqual(c1.length, 1, '(c) inspection stored once');
  assert.strictEqual(photosOf(c1[0]), 1, '(c) photo uploaded once');

  // ── (d) 409 in_progress, then success ───────────────────────────────────────────────────
  let busy = false;
  const inProgress = (route) => { if (busy || route.request().method() !== 'PUT') return route.fallback(); busy = true; return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ ok: false, in_progress: true, status: 'applying', error: 'this entry is being applied — try again in a moment' }) }); };
  await page.route('**/api/field/outbox/**', inProgress);
  await queueInsp('F1d');
  await page.waitForFunction(() => window.__f1Seen || true);
  await page.waitForTimeout(1500);
  assert.ok(busy, '(d) the 409 was answered');
  assert.strictEqual(await queueCount(), 1, '(d) kept after 409');
  assert.match(await outboxText(), /en attente/, '(d) still waiting');
  await syncUntilEmpty();
  await page.unroute('**/api/field/outbox/**', inProgress);
  assert.strictEqual((await byNote('F1d')).length, 1, '(d) applied once');

  // ── (e) a chunk fails mid-upload → only the missing chunks are sent again ───────────────
  let dropped = false;
  const chunkCount = {};
  const dropOne = (route) => { const idx = route.request().url().split('/').pop(); chunkCount[idx] = (chunkCount[idx] || 0) + 1; if (!dropped && idx === '1') { dropped = true; return route.abort('failed'); } return route.fallback(); };
  await page.route('**/api/field/uploads/*/chunks/*', dropOne);
  await queueInsp('F1e', BIG());
  await page.waitForFunction(() => /nouvel essai prévu/.test(document.getElementById('outbox-list').textContent), null, { timeout: 20000 })
    .catch(async () => { throw new Error('(e) not marked will-retry: ' + await outboxText() + ' · ' + await fieldMsg()); });
  assert.ok(dropped, '(e) chunk 1 dropped once');
  await syncUntilEmpty();
  await page.unroute('**/api/field/uploads/*/chunks/*', dropOne);
  assert.ok(Object.keys(chunkCount).length >= 2, '(e) the photo spans several chunks: ' + JSON.stringify(chunkCount));
  assert.strictEqual(chunkCount['0'], 1, '(e) chunk 0 sent once (not re-sent): ' + JSON.stringify(chunkCount));
  assert.strictEqual(chunkCount['1'], 2, '(e) only the failed chunk sent again: ' + JSON.stringify(chunkCount));
  assert.strictEqual((await byNote('F1e')).length, 1, '(e) inspection stored once');

  // ── (f) user A queues, user B signs in on the same browser ──────────────────────────────
  const noNet = (route) => route.request().method() === 'PUT' ? route.abort('internetdisconnected') : route.fallback();
  await page.route('**/api/field/outbox/**', noNet);
  await queueInsp('F1f');
  await page.waitForFunction(() => /nouvel essai prévu/.test(document.getElementById('outbox-list').textContent), null, { timeout: 15000 });
  const fId = (await outboxIds())[0].uuid;
  await page.unroute('**/api/field/outbox/**', noNet);
  await page.close();
  page = await ctx.newPage();
  const fMark = reqs.length;
  await login(page, world.users.edA, '/field/index.html');
  await ready(page);
  await home(); await page.click('#sync'); await page.waitForTimeout(2000);
  assert.strictEqual(await queueCount(), 1, '(f) A\'s entry still on the phone');
  assert.match(await outboxText(), /autre utilisateur/, '(f) shown as "autre utilisateur"');
  assert.ok(!(await outboxText()).includes('F1f'), '(f) its content stays private');
  assert.ok(!reqs.slice(fMark).some((r) => r === 'PUT /api/field/outbox/' + fId), '(f) never sent under B');
  assert.ok(!(await serverOutbox(world.users.edA)).some((x) => x.uuid === fId), '(f) not in B\'s server ledger');
  await page.close();
  page = await ctx.newPage();
  await login(page, world.users.tech, '/field/index.html');
  await ready(page);
  await syncUntilEmpty();
  assert.strictEqual((await serverOutbox(world.users.tech)).find((x) => x.uuid === fId).status, 'applied', '(f) sent once A is back');

  // ── (g) storage full, then a reload ─────────────────────────────────────────────────────
  const hold = (route) => route.request().method() === 'PUT' ? route.abort('internetdisconnected') : route.fallback();
  await page.route('**/api/field/outbox/**', hold);
  await queueInsp('F1g-kept');
  await waitQueue(1);
  await page.evaluate(() => { IDBObjectStore.prototype.put = function () { throw new DOMException('quota', 'QuotaExceededError'); }; });
  await queueInsp('F1g-lost');
  await page.waitForFunction(() => /NON enregistré/.test(document.getElementById('msg').textContent), null, { timeout: 10000 })
    .catch(async () => { throw new Error('(g) no not-saved message: ' + await fieldMsg()); });
  assert.strictEqual(await page.inputValue('#i-notes'), 'F1g-lost', '(g) the refused entry stays in the form');
  await page.reload();
  await ready(page);
  await waitQueue(1);
  assert.match(await outboxText(), /F1g-kept|Inspection/, '(g) the earlier entry is intact after the reload');
  await page.unroute('**/api/field/outbox/**', hold);
  await syncUntilEmpty();
  assert.strictEqual((await byNote('F1g-kept')).length, 1, '(g) earlier entry applied once');
  assert.strictEqual((await byNote('F1g-lost')).length, 0, '(g) the refused one was never queued (and the user was told)');
}, { timeout: 300000 });
