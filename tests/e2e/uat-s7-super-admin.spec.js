'use strict';
// UAT-F seat 7 — SUPER_ADMIN / IT OPERATIONS. AI-SIMULATED committee on a synthetic organisation — NOT user acceptance,
// NOT a production-readiness statement. Pass A = shipped defaults, pass B = plan F pilot profile.
const assert = require('node:assert');
const { runJourney } = require('./fixtures/harness');
const { makeCommittee } = require('./fixtures/uat');

// UAT-OI-03 fixed (G3-UX): S7-08 no longer KNOWN — every admin panel reflows at 320 px.
const KNOWN = {};

runJourney('UAT S7 super_admin / IT operations (simulation, not acceptance)', async (ctx) => {
  const { world } = ctx;
  const c = makeCommittee(Object.assign({ seat: 's7', known: KNOWN }, ctx));
  const me = world.users.sa;

  await c.run(async (pass) => {
    await c.flow('S7-01', 'Console d’administration', async () => {
      const p = await c.page(me, '/reports.html#admin', { wait: 'body' });
      try { await p.waitForTimeout(1500); assert.deepStrictEqual(p.__errs, []); await c.shot(p, 'admin'); return 'console sans erreur'; } finally { await p.__close(); }
    });
    await c.flow('S7-02', 'Journal de sécurité : connexions visibles et exportables', async () => {
      const r = await c.api('GET', '/api/reports/system-log?limit=20', me);
      assert.strictEqual(r.status, 200);
      assert.ok((r.j.rows || []).length > 0, 'events present');
      return (r.j.total || r.j.rows.length) + ' évènements';
    });
    await c.flow('S7-03', 'Fraîcheur des sources : jamais synchronisé ≠ zéro mesuré', async () => {
      const r = await c.api('GET', '/api/sync/status', me);
      assert.strictEqual(r.status, 200);
      const s = JSON.stringify(r.j);
      return 'statut sync 200 ; états vus : ' + [...new Set((s.match(/"(never[_ -]?synced|never|error|stale|partial|ok|fresh|skipped)"/g) || []))].join(',').slice(0, 160);
    });
    await c.flow('S7-04', 'Utilisateurs et configuration : secrets jamais renvoyés', async () => {
      const u = await c.api('GET', '/api/reports/users', me); assert.strictEqual(u.status, 200);
      const cfg = await c.api('GET', '/api/reports/config', me); assert.strictEqual(cfg.status, 200);
      const cf = cfg.j.config || cfg.j;
      for (const k of ['smtp_pass', 'entra_client_secret', 'meraki_api_key']) assert.ok(!cf[k], k + ' redacted');
      return 'liste utilisateurs + config 200, secrets vides';
    });
    await c.flow('S7-05', 'Publication contrôlée de la feuille de route (simulation d’abord)', async () => {
      const r = await c.api('GET', '/api/governance/roadmap-publication', me);
      if (pass === 'A') { assert.strictEqual(r.status, 404); return c.off('roadmap_publication_enabled=0 → 404 (API de migration seule)'); }
      assert.strictEqual(r.status, 200, JSON.stringify(r.j));
      const dry = await c.api('POST', '/api/governance/roadmap-migration', me, {});
      assert.ok([200, 409].includes(dry.status), String(dry.status));
      return 'état ' + JSON.stringify(r.j).slice(0, 100) + ' ; simulation ' + dry.status;
    });
    await c.flow('S7-06', 'Correspondance des départements (lecture seule, proposée)', async () => {
      const r = await c.api('GET', '/api/governance/department-crosswalk', me);
      assert.strictEqual(r.status, 200);
      return `lecture seule=${r.j.read_only} ; roll-up activé=${r.j.rollup_enabled} ; paires=${(r.j.rows || []).length}`;
    });
    await c.flow('S7-07', 'Page Réglages d’espace (sans effet sur les droits)', async () => {
      const p = await c.page(me, '/workspace-settings.html', {});
      try {
        if (pass === 'A') { assert.strictEqual(p.__status, 404); return c.off('page 404 (switch off)'); }
        await p.waitForSelector('#wsForm:not([hidden])', { timeout: 15000 });
        assert.deepStrictEqual(p.__errs, []);
        const n = await p.evaluate(() => document.querySelectorAll('#wsProfile option').length);
        return n + ' profils proposés au super_admin';
      } finally { await p.__close(); }
    });
    await c.flow('S7-08', 'Admin à 320 px', async () => {
      const p = await c.page(me, '/reports.html#admin', { width: 320, wait: 'body' });
      try {
        await p.waitForTimeout(1500);
        assert.deepStrictEqual(await c.layoutProblems(p), [], 'Users panel');
        // UAT-OI-03 — every visible rail entry (and every tab of a grouped entry), not only the Users card
        const rail = await p.evaluate(() => [...document.querySelectorAll('#admin-rail .admin-rail__item')]
          .filter((b) => b.offsetParent !== null).map((b) => b.dataset.panel || b.dataset.group));
        let seen = 0;
        for (const id of rail) {
          await p.evaluate((k) => [...document.querySelectorAll('#admin-rail .admin-rail__item')]
            .find((b) => b.offsetParent !== null && (b.dataset.panel || b.dataset.group) === k).click(), id);
          await p.waitForTimeout(300);
          const tabs = await p.evaluate(() => [...document.querySelectorAll('#ap-grouptabs .ap-tab')].filter((b) => b.offsetParent !== null).length);
          for (let t = 0; t < Math.max(1, tabs); t++) {
            if (tabs) { await p.evaluate((i) => [...document.querySelectorAll('#ap-grouptabs .ap-tab')].filter((b) => b.offsetParent !== null)[i].click(), t); await p.waitForTimeout(300); }
            assert.deepStrictEqual(await c.layoutProblems(p), [], id + (tabs ? ' tab ' + t : ''));
            seen++;
          }
        }
        assert.ok(seen >= 5, 'walked ' + seen + ' admin panels');
        return seen + ' panneaux d\'administration sans défilement horizontal';
      } finally { await p.__close(); }
    });
  });
  c.finish();
}, { timeout: 300000 });
