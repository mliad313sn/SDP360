'use strict';
// Infrastructure Health page — a failure must SAY it failed.
//
// Before this test, public/infra-health.html collapsed three different situations into the
// same "No data / 0 0 0 0" screen: (1) the API call itself failed (401/403/500/network —
// loadSummary swallowed it), (2) the route caught a server error and answered 200 with
// {sites:[], reason}, and (3) there genuinely were no snapshots. Only (3) is "no data".
// An operator looking at (1) or (2) went hunting in the collectors for a problem that was
// really a session, a deploy or a server exception.
//
// The test runs the page's REAL inline script in a vm, against a minimal DOM stub and a
// stubbed fetch — no string-matching on the source.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'infra-health.html'), 'utf8').replace(/\r\n/g, '\n');

function pageScript() {
  const open = HTML.lastIndexOf('<script nonce="%%CSP_NONCE%%">');
  assert.ok(open >= 0, 'inline page script not found');
  const start = HTML.indexOf('>', open) + 1;
  const end = HTML.indexOf('</script>', start);
  const src = HTML.slice(start, end);
  assert.ok(src.includes('loadSummary'), 'sliced the wrong script');
  return src;
}

function makeEl(id) {
  return {
    id, innerHTML: '', textContent: '', className: '', style: {}, dataset: {},
    options: [{ textContent: '' }, { textContent: '' }],
    addEventListener() {}, insertBefore() {}, querySelector() { return null; },
    getContext() { return {}; },
  };
}

async function runPage(fetchImpl, lang = 'fr') {
  const els = {};
  const classes = new Set();
  let ready = null;
  const document = {
    getElementById: id => (els[id] = els[id] || makeEl(id)),
    createElement: () => makeEl(''),
    querySelectorAll: () => [],
    addEventListener: (ev, fn) => { if (ev === 'DOMContentLoaded') ready = fn; },
    body: { classList: {
      add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c),
    } },
  };
  const window = { __authToken: 'tok' };
  const ctx = {
    window, document, fetch: fetchImpl, console,
    localStorage: { getItem: () => lang, setItem() {} },
  };
  vm.createContext(ctx);
  vm.runInContext(pageScript(), ctx);
  ready();
  for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r));
  return els;
}

const respond = (status, body) => async () => ({
  ok: status >= 200 && status < 300, status, json: async () => body,
});

test('HTTP error → the banner and the matrix name the status, never "Aucune donnée"', async () => {
  const els = await runPage(respond(403, { error: 'forbidden' }));
  const banner = els['ih-freshness'].textContent;
  const matrix = els['ih-matrix-body'].innerHTML;
  assert.match(banner, /HTTP 403/);
  assert.match(banner, /[Ee]rreur/);
  assert.match(matrix, /HTTP 403/);
  assert.ok(!matrix.includes('Aucune donnée'), matrix);
});

test('network failure (fetch rejects) → the error is shown', async () => {
  const els = await runPage(async () => { throw new Error('Failed to fetch'); });
  assert.match(els['ih-freshness'].textContent, /Failed to fetch/);
  assert.ok(!els['ih-matrix-body'].innerHTML.includes('Aucune donnée'));
});

test('200 with a server "reason" → the reason is shown, escaped', async () => {
  const els = await runPage(respond(200, { sites: [], reason: 'relation "wan_link_snapshots" <x>' }));
  assert.match(els['ih-freshness'].textContent, /wan_link_snapshots/);
  const matrix = els['ih-matrix-body'].innerHTML;
  assert.match(matrix, /wan_link_snapshots/);
  assert.ok(!matrix.includes('<x>'), 'reason must be HTML-escaped in the matrix');
  assert.ok(!matrix.includes('Aucune donnée'));
});

test('English page → the error is labelled in English', async () => {
  const els = await runPage(respond(500, {}), 'en');
  assert.match(els['ih-freshness'].textContent, /^Error/);
});

test('genuine empty result (no reason) → still "Aucune donnée"', async () => {
  const els = await runPage(respond(200, { sites: [], fleet: {}, coverage: { available: false } }));
  assert.match(els['ih-matrix-body'].innerHTML, /Aucune donnée/);
  assert.strictEqual(els['ih-freshness'].textContent, 'Aucune date de fraîcheur disponible');
});
