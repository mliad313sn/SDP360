'use strict';
// P11 round 4 F-4 — every refusal of the field outbox carries a reason code, and the phone shows its own (French)
// text for each one: no refusal reaches a French phone as the server's English sentence.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const F = require('../services/fieldOutbox');

const ROOT = path.join(__dirname, '..');
const route = fs.readFileSync(path.join(ROOT, 'routes/field.js'), 'utf8').replace(/\r\n/g, '\n');
const app = fs.readFileSync(path.join(ROOT, 'public/field/app.js'), 'utf8').replace(/\r\n/g, '\n');

function dict() {
  let d = null; const store = {};
  const ctx = { window: {}, document: { getElementById: () => null }, localStorage: { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = v; } } };
  ctx.window.I18nText = { install: (o) => { d = o.dict; }, t: (s) => s };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'public/field/i18n.js'), 'utf8'), ctx);
  return d;
}

test('every typed error thrown on the field apply path names a reason from REFUSAL_REASONS', () => {
  const throws = [...route.matchAll(/\{ code: '(INVALID|FORBIDDEN|REJECTED|CONFLICT|VALIDATION)'([^}]*)\}/g)];
  assert.ok(throws.length >= 15, 'found the throw sites: ' + throws.length);
  for (const m of throws) {
    const r = /reason: '([a-z_]+)'/.exec(m[2]);
    assert.ok(r, 'throw without reason: ' + m[0]);
    assert.ok(F.REFUSAL_REASONS.includes(r[1]), 'unknown reason ' + r[1]);
  }
  // route-level refusals (status 400/403/409 answered directly) carry a reason too
  for (const r of ['envelope_invalid', 'wrong_author', 'uuid_other_user', 'uuid_payload_mismatch', 'in_progress', 'field_role']) assert.match(route, new RegExp("reason: '" + r + "'"), r);
  assert.match(route, /reason: e\.reason \|\| F\.fallbackReason\(e\.code\)/, 'a typed error without its own reason still gets a generic code');
});

test('the phone has a translated text for every reason code, and every text has a French entry', () => {
  const d = dict();
  for (const r of F.REFUSAL_REASONS) {
    const pat = new RegExp("(reason === '" + r + "'|case '" + r + "':)");
    assert.match(app, pat, 'no phone text for reason ' + r);
  }
  for (const m of app.matchAll(/FT\('([^']+)'\)/g)) assert.ok(m[1] in d, 'no French for ' + m[1]);
});

test('fallbackReason maps every typed code to a known reason', () => {
  for (const c of ['INVALID', 'VALIDATION', 'FORBIDDEN', 'CONFLICT', 'REJECTED', 'WRITE_DISABLED']) assert.ok(F.REFUSAL_REASONS.includes(F.fallbackReason(c)), c);
});
