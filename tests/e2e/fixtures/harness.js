'use strict';
// B-05 — one journey = one node:test file: boot the real app on a throwaway PostgreSQL database, seed
// it, launch Chromium with external traffic blocked, run the steps, then assert that no request left
// for a non-allow-listed origin and write the artefact (sizes, load times, blocked requests).
const test = require('node:test');
const assert = require('node:assert');
const { bootApp } = require('./server');
const { seed } = require('./seed');
const { launch, journey, login } = require('./browser');

function runJourney(name, steps, opts) {
  test(name, { timeout: (opts && opts.timeout) || 120000 }, async () => {
    const app = await bootApp();
    const world = await ((opts && opts.seed) || seed)(app);   // R6: a journey may bring its own seed (the demo)
    const browser = await launch();
    const j = journey(name);
    let status = 'failed';
    try {
      await steps({ app, base: app.base, world, browser, j, login: (page, u, next) => login(page, app.base, u.username, u.password, next) });
      assert.deepStrictEqual(j.rec.external.unexpected, [], 'requests to non-localhost origins (all blocked) — must be 0');
      status = 'passed';
    } finally {
      j.finish(status);
      await browser.close().catch(() => {});
      await app.close();
    }
  });
}

module.exports = { runJourney };
