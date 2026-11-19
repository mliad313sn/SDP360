'use strict';
// P09 — shared body of tests/e2e/p09-profile-tasks-{a,b}.spec.js. For each profile in the slice: create a synthetic
// account with the profile's minimal roles, turn workspace profiles on (throwaway database), open the landing page and
// check that every task page is ONE click away (a shortcut on home.html, or the landing page itself) and opens without
// a page error. AI-run on a synthetic organisation — NOT user acceptance; task choice is a PROPOSAL (D-P09-4).
const assert = require('node:assert');
const { runJourney } = require('./harness');
const { person } = require('./uat');
const { PROFILE_TASKS } = require('./profile-tasks');

function profileJourney(name, ids) {
  runJourney(name, async ({ app, world, browser, j, login, base }) => {
    await world.setConfig({ workspace_profiles_enabled: '1' });
    const report = [];
    for (const id of ids) {
      const prof = PROFILE_TASKS.find((p) => p.id === id);
      const me = await person(app, 'p09_' + id, prof.roles, prof.site ? world.siteA : null);
      if (prof.choose) { const pr = await world.call('PUT', '/api/workspace/prefs', me.token, { profile: id }); assert.strictEqual(pr.status, 200, id + ' choose profile ' + pr.status); }
      const ws = await world.call('GET', '/api/workspace/me', me.token);
      assert.strictEqual(ws.status, 200, id + ' workspace ' + ws.status);
      assert.strictEqual(ws.j.profile, id, id + ': default profile is ' + ws.j.profile);
      const ctx = await j.newContext(browser, { viewport: { width: 1280, height: 900 } });
      const p = await ctx.newPage();
      const errs = []; p.on('pageerror', (e) => errs.push(String((e && e.message) || e).slice(0, 160)));
      try {
        await login(p, me, '/home.html');
        await p.waitForLoadState('networkidle').catch(() => {});
        const landing = new URL(p.url()).pathname.replace(/^\//, '');
        await p.waitForTimeout(1500);
        const links = await p.evaluate(() => [...document.querySelectorAll('#hmShortcuts a')].map((a) => a.getAttribute('href')));
        for (const t of prof.tasks) {
          const oneClick = landing === t.href.split(/[?#]/)[0] || links.includes(t.href);
          assert.ok(oneClick, `${id}: "${t.en}" (${t.href}) is not one click from ${landing} (shortcuts: ${links.join(', ')})`);
          const q = await ctx.newPage(); const qe = [];
          q.on('pageerror', (e) => qe.push(String((e && e.message) || e).slice(0, 160)));
          const resp = await q.goto(base + '/' + t.href);
          await q.waitForLoadState('networkidle').catch(() => {});
          const status = resp ? resp.status() : 0;
          const finalPath = new URL(q.url()).pathname;
          await q.close();
          assert.strictEqual(status, 200, `${id}: ${t.href} HTTP ${status}`);
          assert.ok(!/login\.html/.test(finalPath), `${id}: ${t.href} sent the user back to login`);
          assert.deepStrictEqual(qe, [], `${id}: ${t.href} page errors`);
          report.push({ profile: id, task: t.en, href: t.href, landing, clicks_from_landing: landing === t.href.split(/[?#]/)[0] ? 0 : 1 });
        }
        assert.deepStrictEqual(errs, [], id + ': landing page errors');
      } finally { await ctx.close(); }
    }
    j.rec.p09_profile_tasks = report;
  }, { timeout: 600000 });
}

module.exports = { profileJourney };
