'use strict';
// B-05 — Chromium for the journeys, with every non-localhost request BLOCKED and COUNTED, and the
// transfer size + load time of every page recorded to an artefact (measurement only, no budget).
//
// External-request policy (ADR-B05):
//   * a request to any host other than 127.0.0.1 / localhost is aborted — nothing ever leaves the
//     runner — and recorded;
//   * ALLOWLIST names the external origins a journey may still TRY to reach. It is EMPTY since C-29
//     (PO decision P5): fonts are served same-origin from public/vendor/fonts, so Google Fonts is now
//     `unexpected` like any other host. Anything allow-listed in future is still aborted and reported
//     under `allowlisted`, never silently ignored;
//   * any other external request is `unexpected` and fails the journey (must be 0).
const fs = require('fs');
const path = require('path');

const ALLOWLIST = [];
const LOCAL = new Set(['127.0.0.1', 'localhost', '[::1]']);

function classify(url) {
  let u;
  try { u = new URL(url); } catch (_) { return 'local'; }
  if (u.protocol === 'data:' || u.protocol === 'blob:' || u.protocol === 'about:' || u.protocol === 'chrome-extension:') return 'local';
  if (LOCAL.has(u.hostname)) return 'local';
  return ALLOWLIST.includes(u.hostname) ? 'allowlisted' : 'unexpected';
}

function loadPlaywright() {
  try { return require('playwright'); } catch (e) {
    throw new Error('[e2e] the playwright devDependency is missing — run `npm ci` and `npx playwright install chromium` (' + e.message.split('\n')[0] + ')');
  }
}

// One browser per spec file; one context per journey (or per user inside a journey).
async function launch() {
  const pw = loadPlaywright();
  return pw.chromium.launch();
}

function artifactDir() {
  const d = process.env.E2E_ARTIFACT_DIR || path.join(__dirname, '..', '..', '..', 'e2e-artifacts');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

// A journey recorder: wraps contexts it creates so blocked requests, page sizes and load times
// land in one record, written by finish().
function journey(name) {
  const rec = { journey: name, started_at: new Date().toISOString(), external: { unexpected: [], allowlisted: [] }, pages: [], page_errors: [] };
  const sizes = new Map();   // page → running transfer bytes for its current document

  async function newContext(browser, opts) {
    const ctx = await browser.newContext(Object.assign({ serviceWorkers: 'block', locale: 'en-GB' }, opts || {}));
    await ctx.route('**/*', (route) => {
      const url = route.request().url();
      const kind = classify(url);
      if (kind === 'local') return route.continue();
      rec.external[kind].push(url);
      return route.abort('blockedbyclient');
    });
    ctx.on('page', (p) => watch(p));
    return ctx;
  }

  function watch(page) {
    page.on('pageerror', (e) => rec.page_errors.push({ url: page.url(), message: String(e && e.message || e).slice(0, 300) }));
    page.on('requestfinished', async (req) => {
      try {
        const s = await req.sizes();
        sizes.set(page, (sizes.get(page) || 0) + (s.responseBodySize || 0) + (s.responseHeadersSize || 0));
      } catch (_) { /* request from a closed page */ }
    });
    page.on('framenavigated', (f) => { if (f === page.mainFrame()) sizes.set(page, 0); });
  }

  // Call after a page reached its settled state: records the bytes since its last navigation and the
  // navigation timing of the current document.
  async function measure(page, label) {
    const t = await page.evaluate(() => {
      const n = performance.getEntriesByType('navigation')[0];
      if (!n) return null;
      return { dom_content_loaded_ms: Math.round(n.domContentLoadedEventEnd), load_ms: Math.round(n.loadEventEnd), transfer_bytes_doc: n.transferSize };
    }).catch(() => null);
    rec.pages.push(Object.assign({ label, path: new URL(page.url()).pathname, transfer_bytes: sizes.get(page) || 0 }, t || {}));
  }

  function finish(status) {
    rec.finished_at = new Date().toISOString();
    rec.status = status;
    rec.external.unexpected_count = rec.external.unexpected.length;
    rec.external.allowlisted_count = rec.external.allowlisted.length;
    const f = path.join(artifactDir(), name.replace(/[^a-z0-9-]+/gi, '_') + '.json');
    fs.writeFileSync(f, JSON.stringify(rec, null, 1) + '\n');
    return rec;
  }

  return { rec, newContext, watch, measure, finish };
}

// Logs in through the real login page. `next` is where the page sends the user afterwards.
async function login(page, base, username, password, next) {
  await page.goto(base + '/login.html' + (next ? '?next=' + encodeURIComponent(next) : ''));
  await page.fill('#username', username);
  await page.fill('#password', password);
  await Promise.all([page.waitForURL((u) => !/\/login\.html/.test(u.pathname), { timeout: 15000 }), page.click('#btnLogin')]);
}

// E-F02 — simulated network conditions on one page (Chromium DevTools protocol). latency in ms, offline true/false.
// SIMULATED only: it proves the app's logic under delay and drops, not a real VSAT / 4G link (human gate E-F04).
async function netConditions(page, { offline = false, latency = 0, down = -1, up = -1 } = {}) {
  if (!page.__cdp) { page.__cdp = await page.context().newCDPSession(page); await page.__cdp.send('Network.enable'); }
  await page.__cdp.send('Network.emulateNetworkConditions', { offline, latency, downloadThroughput: down, uploadThroughput: up });
}

module.exports = { ALLOWLIST, classify, launch, journey, login, artifactDir, netConditions };
