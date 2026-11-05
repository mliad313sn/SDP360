'use strict';
// C-24 (G32) — filter race on Dashboards and Analytics: the user changes a filter twice in quick
// succession; the FIRST response is held back and arrives LAST. The screen must show the second
// filter's figures — the late, older response must never overwrite the newer one (Annex B #6 / F11).
// Each response is tagged (route.fetch + a marker in the JSON) so the test can tell which one rendered.
const assert = require('node:assert');
const { runJourney } = require('./fixtures/harness');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Holds the first matching request for `holdMs`, tags every matching response with `tag(json, n)`.
// Returns { delivered }: a promise that resolves once the held (stale) response has been delivered
// (wrapped — an async function returning a bare promise would make the caller await the delivery).
async function raceRoute(page, pattern, accept, tag, holdMs) {
  let n = 0, staleDone;
  const delivered = new Promise((r) => { staleDone = r; });
  await page.route(pattern, async (route) => {
    if (!accept(route.request().url())) return route.continue();
    const i = ++n;
    const res = await route.fetch();
    const j = await res.json();
    tag(j, i);
    if (i === 1) await sleep(holdMs);
    await route.fulfill({ response: res, json: j });
    if (i === 1) staleDone();
  });
  return { delivered };
}

runJourney('R1 filter race dashboards and analytics never show the older response', async ({ base, world, browser, j, login }) => {
  const ctx = await j.newContext(browser, { viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await login(page, world.users.sa, '/home.html');

  // ── Dashboards: two site changes, the first answer arrives last ────────────────────
  const list = await world.call('GET', '/api/dashboards', world.users.sa.token);
  const dash = (list.j.dashboards || []).find((d) => d.status === 'published');
  assert.ok(dash, 'a published dashboard exists after seedStores');
  await page.goto(base + '/dashboards.html?key=' + encodeURIComponent(dash.key));
  await page.waitForFunction(() => document.getElementById('site').options.length >= 2, null, { timeout: 20000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  const opts = await page.$$eval('#site option', (os) => os.map((o) => o.value));
  const cur = await page.inputValue('#site');
  const [first, second] = opts.filter((v) => v !== cur).concat(opts).slice(0, 2);
  assert.notStrictEqual(first, second, 'two different sites to choose from');
  const { delivered: staleDash } = await raceRoute(page, '**/api/dashboards/*/data?*',
    (u) => /[?&]site=/.test(u), (json, i) => { json.note = i === 1 ? 'E2E-STALE-RESPONSE' : 'E2E-FRESH-RESPONSE'; }, 2500);
  await page.selectOption('#site', first);
  await sleep(150);
  await page.selectOption('#site', second);
  await page.waitForSelector('#status:has-text("E2E-FRESH-RESPONSE")', { timeout: 15000 });
  await staleDash; await sleep(500);
  assert.match(await page.textContent('#status'), /E2E-FRESH-RESPONSE/, 'dashboards: the newer response stays on screen');
  assert.strictEqual(await page.inputValue('#site'), second, 'dashboards: the site filter is not flipped back by the late response');
  await j.measure(page, 'dashboards-race');
  await page.unroute('**/api/dashboards/*/data?*');

  // ── Analytics: two site changes, the first answer arrives last ─────────────────────
  await page.goto(base + '/analytics.html');
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  const { delivered: staleAn } = await raceRoute(page, '**/api/metrics/requests?*',
    (u) => /[?&]site=/.test(u), (json, i) => { json.data = Object.assign({}, json.data, { open_count: i === 1 ? 11111 : 22222 }); }, 2500);
  // Analytics serialises loads (AL.createLoadCoordinator) — so also record every value the tile ever
  // shows: the held Sabodala answer must never be painted, not even for a moment.
  await page.evaluate(() => { const el = document.getElementById('kv-req-open'); window.__e2eSeen = [];
    new MutationObserver(() => window.__e2eSeen.push(el.textContent)).observe(el, { childList: true, characterData: true, subtree: true }); });
  await page.selectOption('#fSite', 'Sabodala');
  await sleep(150);
  await page.selectOption('#fSite', 'MANA');
  await page.waitForFunction(() => /22.?222/.test(document.getElementById('kv-req-open').textContent), null, { timeout: 15000 });
  await staleAn; await sleep(500);
  const shown = await page.textContent('#kv-req-open');
  assert.match(shown, /22.?222/, 'analytics: the newer response stays on screen');
  assert.doesNotMatch(shown, /11.?111/, 'analytics: the older response never overwrote it');
  assert.strictEqual(await page.inputValue('#fSite'), 'MANA');
  const seen = await page.evaluate(() => window.__e2eSeen);
  assert.ok(!seen.some((t) => /11.?111/.test(t)), 'analytics: the older response was never painted: ' + JSON.stringify(seen));
  await j.measure(page, 'analytics-race');
});
