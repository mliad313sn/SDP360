'use strict';
// T3 — a technician records a quick inspection with ONE photo while offline, then syncs.
// Success = the entry leaves the phone's outbox, the inspection is stored for the site with its photo,
// and the photo is visible on the inspection page.
const assert = require('node:assert');
const zlib = require('zlib');
const { runJourney } = require('./fixtures/harness');

// a real 32×24 PNG built here (no binary fixture in the repository)
function png(w, h) {
  const crc = (b) => { let c, k, t = []; for (let n = 0; n < 256; n++) { c = n; for (k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } c = 0xFFFFFFFF; for (const x of b) c = t[(c ^ x) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = 239; raw[o + 1] = 99 + y; raw[o + 2] = 26 + x; }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

runJourney('T3 field quick inspection offline then online sync with one photo', async ({ base, world, browser, j, login }) => {
  const ctx = await j.newContext(browser);
  await ctx.addInitScript(() => { try { localStorage.setItem('field_lang', 'en'); } catch (_) {} });
  const page = await ctx.newPage();
  await login(page, world.users.tech, '/field/index.html');
  await page.waitForFunction(() => { const s = document.getElementById('site'); return s && s.options.length > 0; });
  await j.measure(page, 'field');

  await ctx.setOffline(true);
  await page.click('nav.tabs button[data-view="inspect"]');
  await page.waitForSelector('#i-items button[data-ix]');
  await page.locator('#i-items button[data-st]').first().click();
  await page.setInputFiles('#i-photo', { name: 'rack.png', mimeType: 'image/png', buffer: png(32, 24) });
  await page.waitForFunction(() => document.querySelectorAll('#i-photos img').length === 1, null, { timeout: 5000 })
    .catch(async () => { throw new Error('photo not added; field message: ' + await page.textContent('#msg')); });
  await page.fill('#i-notes', 'E2E offline capture');
  await page.click('#i-save');
  await page.waitForFunction(() => document.getElementById('queue').textContent === '1', null, { timeout: 10000 })
    .catch(async () => { throw new Error('not queued; field message: ' + await page.textContent('#msg') + ' dbg=' + await page.evaluate(() => window.__dbg)); });

  await ctx.setOffline(false);
  await page.click('nav.tabs button[data-view="home"]');
  await page.click('#sync');
  await page.waitForFunction(() => document.getElementById('queue').textContent === '0', null, { timeout: 30000 });

  const list = await world.call('GET', '/api/inspection/list?site=HGO', world.users.edA.token);
  const rows = (list.j && (list.j.rows || list.j.items || list.j)) || [];
  const mine = (Array.isArray(rows) ? rows : []).find((r) => /Field quick capture/.test(r.label || '') || /E2E offline capture/.test(r.key_observations || ''));
  assert.ok(mine, 'the synced inspection is stored for site HGO: ' + JSON.stringify(list.j).slice(0, 300));
  const rec = await world.call('GET', '/api/inspection/' + encodeURIComponent(mine.id), world.users.edA.token);
  assert.strictEqual((rec.j.photos || []).length, 1, 'exactly one photo arrived');

  // photo visible on the dashboard side (the inspection page), as the site editor
  const ctx2 = await j.newContext(browser);
  const p2 = await ctx2.newPage();
  await login(p2, world.users.edA, '/inspection.html?id=' + encodeURIComponent(mine.id));
  await p2.waitForFunction(() => Array.from(document.querySelectorAll('img')).some((i) => /^data:image\//.test(i.src) || /\/blob/.test(i.src)), null, { timeout: 20000 });
  await j.measure(p2, 'inspection');
});
