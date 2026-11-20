'use strict';
// P11 round 6 (UX/field) — F-24: a database stall answered 503 database_busy and the phone showed the raw code
// "database_busy". Every server error code the field app can receive without a reason (database_busy,
// internal_error, a 429) now has an EN/FR text, and the entry stays "will retry" with a retry scheduled.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(ROOT, 'public/field/app.js'), 'utf8').replace(/\r\n/g, '\n');
const { UNAVAILABLE_CODES } = require('../services/httpError');

function dict() {
  let d = null; const store = {};
  const ctx = { window: {}, document: { getElementById: () => null }, localStorage: { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = v; } } };
  ctx.window.I18nText = { install: (o) => { d = o.dict; }, t: (s) => s };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'public/field/i18n.js'), 'utf8'), ctx);
  return d;
}
// extract the pure helpers from app.js and run them with a FT that marks translation
function helpers(ft) {
  const grab = (name) => { const i = app.indexOf('function ' + name + '('); assert.ok(i >= 0, name); let depth = 0, j = app.indexOf('{', i); for (; j < app.length; j++) { if (app[j] === '{') depth++; else if (app[j] === '}' && --depth === 0) break; } return app.slice(i, j + 1); };
  const src = grab('isTransient') + '\n' + grab('serverErrorText') + '\nmodule.exports = { isTransient, serverErrorText };';
  const m = { exports: {} };
  vm.runInNewContext(src, { module: m, FT: ft });
  return m.exports;
}

test('every 503 code the server sends has its own phone text, in EN and FR', () => {
  const d = dict();
  const h = helpers((s) => s);
  for (const k of Object.keys(UNAVAILABLE_CODES)) {
    const code = UNAVAILABLE_CODES[k].error;
    const t = h.serverErrorText(UNAVAILABLE_CODES[k].status, code, null);
    assert.ok(!t.includes(code), 'the raw code is never shown: ' + code);
    assert.ok(t in d, 'French text for ' + t);
  }
  for (const [st, code] of [[500, 'internal_error'], [429, 'Too many'], [502, undefined]]) {
    const t = h.serverErrorText(st, code, 'abc-123');
    assert.ok(!/internal_error|database_busy/.test(t));
    assert.match(t, /abc-123/, 'the support reference is kept');
    assert.ok(t.replace(/ \(reference abc-123\)$/, '') in d, 'French text for ' + t);
  }
  const fr = helpers((s) => d[s] || s).serverErrorText(503, 'database_busy');
  assert.match(fr, /serveur est occupé/);
});

test('a 5xx or 429 is transient (kept, retried later), a 4xx refusal is not', () => {
  const h = helpers((s) => s);
  for (const s of [500, 502, 503, 429]) assert.equal(h.isTransient(s), true, String(s));
  for (const s of [400, 403, 409, 413]) assert.equal(h.isTransient(s), false, String(s));
  // the send path marks the entry failed (= "will retry"), schedules a retry, and stops the round on database_busy
  const i = app.indexOf('if (isTransient(j.__status)) {');
  assert.ok(i > 0);
  const block = app.slice(i, i + 600);
  assert.match(block, /e\.state = 'failed'/);
  assert.match(block, /scheduleRetry\(j\.__retryAfter\)/);
  assert.match(block, /database_busy/);
  assert.ok(!/e\.last_error = j\.error/.test(app), 'the raw server code is never stored as the phone text');
  assert.match(app, /j\.__retryAfter = r\.headers\.get\('retry-after'\)/);
  assert.match(app, /setTimeout\(function \(\) \{ retryTimer = null; flush\(\); \}/);
});

test('every FT() text of the field app has a French entry', () => {
  const d = dict();
  for (const m of app.matchAll(/FT\('([^']+)'\)/g)) assert.ok(m[1] in d, 'no French for ' + m[1]);
});
