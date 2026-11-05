'use strict';
// C-24 (G32) — the key pages at 1440 / 1024 / 768 / 390 px: no horizontal page scroll, the shell header
// visible and inside the viewport, header and content not overlapping, no box escaping the viewport
// outside a scroll container, and no console error / uncaught page error.
// Structural assertions only (fixtures/layout.js) — the viewport screenshots are written to the artefact
// folder for a PERSON to look at; they are never compared or auto-approved.
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { runJourney } = require('./fixtures/harness');
const { artifactDir, classify } = require('./fixtures/browser');
const layout = require('./fixtures/layout');

const WIDTHS = [1440, 1024, 768, 390];
const PAGES = ['index', 'dashboards', 'analytics', 'assets', 'wan', 'cockpit', 'site-actions', 'access'];

runJourney('V1 viewport matrix key pages layout and console', async ({ base, world, browser, j, login }) => {
  const shots = path.join(artifactDir(), 'viewports');
  fs.mkdirSync(shots, { recursive: true });
  const problems = [];
  for (const w of WIDTHS) {
    const ctx = await j.newContext(browser, { viewport: { width: w, height: 900 } });
    const page = await ctx.newPage();
    let errs = [];
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const loc = (m.location() && m.location().url) || '';
      // a blocked request to an allow-listed origin (fonts, ADR-B05) is reported by the harness, not here
      if (/ERR_BLOCKED_BY_CLIENT/.test(m.text()) && j.rec.external.unexpected.length === 0 && (classify(loc) !== 'unexpected')) return;
      errs.push(m.text().slice(0, 200));
    });
    page.on('pageerror', (e) => errs.push('uncaught: ' + String(e && e.message || e).slice(0, 200)));
    await login(page, world.users.sa, '/home.html');
    for (const p of PAGES) {
      errs = [];
      await page.goto(base + '/' + p + '.html');
      await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
      assert.strictEqual(new URL(page.url()).pathname, '/' + p + '.html', p + ' at ' + w + ' px was redirected');
      const m = await page.evaluate(layout.measure);
      const bad = layout.judge(m);
      if (errs.length) bad.push('console errors: ' + errs.join(' | '));
      if (bad.length) problems.push(`${p} @${w}px: ${bad.join('; ')}`);
      if (w === 1440) await j.measure(page, p);
      await page.screenshot({ path: path.join(shots, `${p}-${w}.png`) }).catch(() => {});
    }
    await ctx.close();
  }
  assert.deepStrictEqual(problems, [], 'layout / console problems');
}, { timeout: 400000 });
