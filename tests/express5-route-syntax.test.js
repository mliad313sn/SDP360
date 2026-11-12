'use strict';
// G2-PLATFORM (2026-11-12) — every route PATH STRING must be valid for Express 5.
// Express 5 uses path-to-regexp v8, which rejects the v0.1 syntax Express 4 accepted:
// inline groups `:fmt(a|b)`, optional `:x?`, wildcards `*`, `+`, and bare `( ) [ ] { } !`.
// A route written that way crashes the server at boot under Express 5. RegExp OBJECTS
// (e.g. `app.get(/^\/api\/…$/)`) are still accepted by Express 5 and are not checked here.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
function sources() {
  const out = [path.join(ROOT, 'server.js')];
  for (const d of ['routes', 'services']) {
    for (const f of fs.readdirSync(path.join(ROOT, d))) if (f.endsWith('.js')) out.push(path.join(ROOT, d, f));
  }
  return out;
}
const CALL = /\b(?:app|router)\.(?:get|post|put|patch|delete|all|use|route)\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g;
const ILLEGAL = /[()[\]?+*{}!]/;

function routePaths() {
  const found = [];
  for (const file of sources()) {
    const src = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    let m; CALL.lastIndex = 0;
    while ((m = CALL.exec(src))) {
      // a template literal's ${expr} is not path syntax — blank it before checking
      const p = m[2].replace(/\$\{[^}]*\}/g, 'X');
      found.push({ file: path.relative(ROOT, file), path: p });
    }
  }
  return found;
}

test('the scanner sees the route table (sanity)', () => {
  const all = routePaths();
  assert.ok(all.length > 300, `expected hundreds of route literals, saw ${all.length}`);
  assert.ok(all.some(r => r.path === '/api/report-studio/runs/:id.:fmt'), 'report-studio export route found');
});

test('no route path uses syntax Express 5 (path-to-regexp v8) rejects', () => {
  const bad = routePaths().filter(r => ILLEGAL.test(r.path));
  assert.deepEqual(bad, [], 'Express-5-incompatible route paths:\n' + bad.map(b => `${b.file}: ${b.path}`).join('\n'));
});

test('the scanner flags the old inline-group form (self-test)', () => {
  assert.ok(ILLEGAL.test('/api/report-studio/runs/:id.:fmt(html|pdf)'));
  assert.ok(ILLEGAL.test('/files/*'));
  assert.ok(ILLEGAL.test('/a/:b?'));
  assert.ok(!ILLEGAL.test('/api/meetings/:id/export-pptx'));
});
