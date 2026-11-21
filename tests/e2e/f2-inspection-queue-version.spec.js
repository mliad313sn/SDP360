'use strict';
// F2 (P11 r9 F-32) — the inspection form on a flaky link. A save that fails and is then stored by the offline queue
// drain must leave the form on the version that save stored: the user's next Save now is accepted (200), never a
// false "someone else saved this inspection" (409). Also: two drains started together, and the boot drain after a
// reload, never produce a false conflict.
const assert = require('node:assert');
const { runJourney } = require('./fixtures/harness');

runJourney('F2 inspection save stored by the offline queue, then Save now again', async ({ app, world, browser, j, login }) => {
  const sites = await app.rdb.listSites({ includeInactive: true });
  const hounde = sites.find((s) => /hounde/i.test(s.name));
  const id = 'EM-IT-20261121-9951';
  const meta = { f_id: id, f_site: `${hounde.name} (HGO)`, f_date: '2026-11-21', f_time: '08:00', f_area: 'dc', f_inspector: 'E2E edA', f_type: 'routine' };
  const c = await world.call('POST', '/api/inspection/save', world.users.edA.token, { state: { meta, items: {}, actions: [{ description: 'A1', owner: 'Alice', priority: 'High', status: 'Open' }], status: 'draft' } });
  assert.strictEqual(c.status, 200, 'inspection created');

  const ctx = await j.newContext(browser);
  const page = await ctx.newPage();
  const dialogs = [];
  page.on('dialog', async (d) => { dialogs.push(d.message().slice(0, 120)); await d.dismiss(); });
  const saves = [];
  let abortNext = 0, delayMs = 0;
  await page.route('**/api/inspection/save', async (route) => {
    if (abortNext > 0) { abortNext--; saves.push('aborted'); return route.abort('failed'); }
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    const resp = await route.fetch(); saves.push(resp.status()); return route.fulfill({ response: resp });
  });
  const ready = () => page.waitForFunction((x) => typeof state !== 'undefined' && state && state.meta && state.meta.f_id === x && !!state.server_version, id, { timeout: 30000 });
  await login(page, world.users.edA, '/inspection.html?id=' + encodeURIComponent(id));
  await ready();
  const serverVersion = async () => (await world.call('GET', '/api/inspection/' + encodeURIComponent(id), world.users.edA.token)).j.state.server_version;
  const v0 = await page.evaluate(() => state.server_version);

  // (a) Save now fails once; the immediate queue drain stores it; the form takes the new version
  abortNext = 1;
  const ok1 = await page.evaluate(() => { state.meta.f_obs = 'edit 1'; window.saveCurrent(); return window.forceSyncNow(); });
  const v1 = await page.evaluate(() => state.server_version);
  assert.deepStrictEqual(saves, ['aborted', 200]);
  assert.strictEqual(ok1, true, 'the drain stored the save: reported as saved, not "Server queued"');
  assert.notStrictEqual(v1, v0, 'the form moved to the version its drained save stored');
  assert.strictEqual(v1, await serverVersion());

  // (b) the next Save now is accepted — no false "changed by someone else"
  const ok2 = await page.evaluate(() => { state.meta.f_obs = 'edit 2'; window.saveCurrent(); return window.forceSyncNow(); });
  assert.strictEqual(ok2, true);
  assert.strictEqual(saves[saves.length - 1], 200);
  assert.deepStrictEqual(dialogs, [], 'no conflict dialog');

  // (c) offline: Save now and its drain both fail (queued); two drains then start together — one stores, no 409
  abortNext = 2;
  await page.evaluate(() => { state.meta.f_obs = 'edit 3'; window.saveCurrent(); return window.forceSyncNow(); });
  assert.deepStrictEqual(await page.evaluate(() => window.__inspectionSync.readQueue()), [id], 'queued');
  delayMs = 400;
  await page.evaluate(() => Promise.all([window.__inspectionSync.flushQueue(), window.__inspectionSync.flushQueue()]));
  delayMs = 0;
  assert.deepStrictEqual(await page.evaluate(() => window.__inspectionSync.readQueue()), []);
  assert.ok(!saves.includes(409), 'no drain was refused: ' + JSON.stringify(saves));
  assert.strictEqual(await page.evaluate(() => state.server_version), await serverVersion());
  const ok3 = await page.evaluate(() => { state.meta.f_obs = 'edit 4'; window.saveCurrent(); return window.forceSyncNow(); });
  assert.strictEqual(ok3, true);

  // (d) queued while offline, then the page is reloaded: the boot drain stores it and the next Save now passes
  abortNext = 2;
  await page.evaluate(() => { state.meta.f_obs = 'edit 5'; window.saveCurrent(); return window.forceSyncNow(); });
  await page.reload();
  await ready();
  await page.waitForFunction(() => window.__inspectionSync && window.__inspectionSync.readQueue().length === 0, null, { timeout: 20000 });
  assert.strictEqual((await world.call('GET', '/api/inspection/' + encodeURIComponent(id), world.users.edA.token)).j.state.meta.f_obs, 'edit 5', 'the boot drain stored the queued save');
  const ok5 = await page.evaluate(() => { state.meta.f_obs = 'edit 6'; window.saveCurrent(); return window.forceSyncNow(); });
  assert.strictEqual(ok5, true, 'Save now after the boot drain is accepted: ' + JSON.stringify(saves));
  assert.ok(!saves.includes(409), JSON.stringify(saves));
  assert.deepStrictEqual(dialogs, []);
  await ctx.close();
});
