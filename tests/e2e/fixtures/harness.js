'use strict';
// B-05 — one journey = one node:test file: boot the real app on a throwaway PostgreSQL database, seed
// it, launch Chromium with external traffic blocked, run the steps, then assert that no request left
// for a non-allow-listed origin — from the browser OR from the server (UAT-OI-07, outboundGuard.js) — and
// write the artefact (sizes, load times, blocked requests).
const test = require('node:test');
const assert = require('node:assert');
const { bootApp } = require('./server');
const { seed } = require('./seed');
const { launch, journey, login } = require('./browser');

function runJourney(name, steps, opts) {
  test(name, { timeout: (opts && opts.timeout) || 120000 }, async () => {
    const app = await bootApp();
    const world = await ((opts && opts.seed) || seed)(app);   // R6: a journey may bring its own seed (the demo)
    // UAT-F pass B: UAT_PILOT_PROFILE=1 re-runs any journey with the plan F pilot switches ON (throwaway database only)
    if (process.env.UAT_PILOT_PROFILE === '1') await require('../../../services/reportConfig').setConfig(app.rdb.db, require('./uat').PILOT_PROFILE, 'uat-pilot');
    const browser = await launch();
    const j = journey(name);
    let status = 'failed';
    try {
      await steps({ app, base: app.base, world, browser, j, login: (page, u, next) => login(page, app.base, u.username, u.password, next) });
      assert.deepStrictEqual(j.rec.external.unexpected, [], 'requests to non-localhost origins (all blocked) — must be 0');
      // UAT-OI-07 — the server side: connections the app tried to open to a non-loopback host (all refused)
      assert.deepStrictEqual(app.outbound.attempts(), [], 'server outbound connections (all refused) — must be 0');
      status = 'passed';
    } finally {
      j.rec.external.server_unexpected = app.outbound.attempts();
      j.finish(status);
      await browser.close().catch(() => {});
      await app.close();
    }
  });
}

module.exports = { runJourney };
