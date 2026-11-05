'use strict';
// D-08 (AMDEC AM-13 rest) — static guard of public/reports.html: every value interpolated into an innerHTML
// template is escaped (esc / escJsonAttr / a number), and no inline on*= handler carries a raw JSON.stringify.
// WF-06 pins the report list; this pins the rest of the page (cards, modals, admin tables, error states).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'reports.html'), 'utf8').replace(/\r\n/g, '\n');
const lineOf = (i) => SRC.slice(0, i).split('\n').length;

// Fields that are numbers / ids / internal constants — safe without esc().
const SAFE_FIELD = /\.(id|site_id|report_id|origin_id|sort_order|length|ageing_total|inbound|closed|res_ok_pct|fr_ok_pct|avg_[a-z_]+)$/;
const SAFE_OBJ = /^cfg\./;   // PANEL_GROUPS — in-page constants

test('every member/error value reaching an innerHTML template is escaped', () => {
  const re = /\$\{([A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)+|e|err)\}/g;
  const sink = /\.innerHTML\s*\+?=|\.textContent\s*=|\.value\s*=|lines\.push\(|toast\(|confirm\(|prompt\(|\.download\s*=|\.title\s*=|api\(|fetch\(|console\.|new Error\(|\bfunction\b/g;
  const offenders = [];
  let m;
  while ((m = re.exec(SRC))) {
    const before = SRC.slice(Math.max(0, m.index - 2500), m.index);
    const all = [...before.matchAll(sink)];
    const last = all.length ? all[all.length - 1][0] : '';
    if (!/innerHTML/.test(last)) continue;
    if (SAFE_FIELD.test(m[1]) || SAFE_OBJ.test(m[1])) continue;
    offenders.push(`${lineOf(m.index)}: ${m[0]}`);
  }
  assert.deepEqual(offenders, []);
});

test('no raw error text in an innerHTML template', () => {
  assert.doesNotMatch(SRC, /innerHTML[^;\n]*\$\{(e|err)(\.message)?\}/);
  assert.doesNotMatch(SRC, /innerHTML[^;\n]*' \+ e \+ '/);
});

test('inline handlers pass values through escJsonAttr, never a raw JSON.stringify', () => {
  assert.doesNotMatch(SRC, /\son[a-z]+=["'][^"'\n]*\$\{JSON\.stringify/);
  assert.doesNotMatch(SRC, /\son[a-z]+='[^'\n]*\$\{/, 'single-quoted handlers break on an apostrophe in the data');
  assert.match(SRC, /function escJsonAttr\(v\) \{ return esc\(JSON\.stringify/);
  // the week label in the carry-over modal is a string argument, not concatenated source
  assert.match(SRC, /_importFromWeek\(\$\{Number\(w\.report_id\)\},\$\{escJsonAttr\(/);
});

test('escJsonAttr round-trips a hostile label through an attribute (quotes, apostrophes, angle brackets)', () => {
  const { fnSource } = require('./_fn-source');
  // eslint-disable-next-line no-new-func
  const { escJsonAttr } = new Function(`${fnSource(SRC, 'esc')}\n${SRC.split('\n').find((l) => l.startsWith('function escJsonAttr('))}\nreturn { esc, escJsonAttr };`)();
  const v = `W37 "x" O'Neil <img src=x onerror=alert(1)> & co`;
  const attr = escJsonAttr(v);
  assert.doesNotMatch(attr, /["'<>]/);
  const decoded = attr.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  assert.equal(JSON.parse(decoded), v);
});
