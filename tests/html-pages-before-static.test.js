'use strict';
// Every page in the boot-time _htmlCache must be routed through sendHtmlPage BEFORE
// express.static — otherwise static serves the raw file: no CSP nonce, no ?v= asset
// versioning (found 2026-11-04: commitments/handoffs/obligations/policies were routed
// only by routers mounted after static).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8').replace(/\r\n/g, '\n');
const lines = src.split('\n');
const staticAt = lines.findIndex((l) => l.includes("app.use(express.static(path.join(__dirname, 'public')"));

function cachedPages() {
  const i = lines.findIndex((l) => /forEach\(loadHtml\)/.test(l));
  const start = lines.slice(0, i + 1).map((l, k) => [l, k]).reverse().find(([l]) => /^\s*\[/.test(l) || /= \[/.test(l));
  const block = lines.slice(start ? start[1] : i - 40, i + 1).join('\n');
  return [...new Set([...block.matchAll(/'([a-z0-9-]+\.html)'/g)].map((m) => m[1]))];
}

function routedBeforeStatic(page) {
  const head = lines.slice(0, staticAt).join('\n');
  if (head.includes(`'/${page}'`)) return true;
  // pages registered through a loop over a literal list, or through a router mounted before static
  for (const m of head.matchAll(/for \(const (\w+) of \[([^\]]*)\]\) app\.get\('\/' \+ \1/g)) if (m[2].includes(`'${page}'`)) return true;
  for (const m of head.matchAll(/app\.use\(require\('\.\/routes\/(\w+)'\)/g)) {
    const r = fs.readFileSync(path.join(ROOT, 'routes', m[1] + '.js'), 'utf8');
    if (r.includes(`router.get('/${page}'`)) return true;
  }
  return false;
}

test('express.static is mounted', () => assert.ok(staticAt > 0));

test('every boot-cached page is served by sendHtmlPage before express.static', () => {
  const pages = cachedPages();
  assert.ok(pages.length > 20, `found ${pages.length} cached pages`);
  const late = pages.filter((p) => !['login.html'].includes(p) && !routedBeforeStatic(p));
  assert.deepStrictEqual(late, []);
});
