'use strict';
// Step 5 — server.js only shrinks. The budget is lowered by hand each time an extraction lands
// (target < 3 000 lines, docs/sdp360/08 §9.6); raising it is a reviewed decision, never a reflex.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const BUDGET = 8300;   // 2026-10-19: meetings routes extracted (9164 -> 8298)

test(`server.js stays under its line budget (${BUDGET})`, () => {
  const n = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8').split('\n').length;
  assert.ok(n <= BUDGET, `server.js has ${n} lines, budget ${BUDGET} — extract a module, do not raise the budget`);
});

test('no page compiles JSX in the browser (Babel standalone is gone)', () => {
  const pub = path.join(__dirname, '..', 'public');
  const offenders = [];
  (function walk(d) {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n);
      if (fs.statSync(p).isDirectory()) { if (!/dashboard-preview|design-system|node_modules/.test(n)) walk(p); continue; }
      if (!n.endsWith('.html')) continue;
      const s = fs.readFileSync(p, 'utf8');
      if (/text\/babel|babel\.min\.js|@babel\/standalone/.test(s)) offenders.push(path.relative(pub, p));
    }
  })(pub);
  assert.deepEqual(offenders, []);
});
