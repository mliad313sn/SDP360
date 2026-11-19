'use strict';
// P06 — the two collision hot spots only shrink. server.js and reports-db.js each carry a line ceiling, and
// server.js an inline-route ceiling (app.get/post/put/patch/delete/all registrations). Lower the numbers in the
// same commit as each extraction (ADR docs/ai-decisions/ADR-P06-monolith-module-map.md); raising one is a
// reviewed decision, never a reflex. tests/server-size-budget.test.js keeps its own (older) server.js budget.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const CEILINGS = {
  'server.js': { lines: 5718, inlineRoutes: 161 },   // 2026-11-19 P05 merge +2 (concurrent deck reads); P06: 6915 lines / 207 routes at e8900a7
  'reports-db.js': { lines: 5732 },                  // 2026-11-19 P11 fix 2 +7 (listSurveyResultIds: survey truncation guard restores missing live results); P05 merge +11 (single-scan calendar helpdesk reader); P06: 5860 at e8900a7 -> 5714 (system log + rate-limit stores moved to services/)
};

for (const [file, c] of Object.entries(CEILINGS)) {
  const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  test(`${file} stays under ${c.lines} lines`, () => {
    const n = src.split('\n').length;
    assert.ok(n <= c.lines, `${file} has ${n} lines, ceiling ${c.lines} — extract to routes/<domain>.js or services/<domain>Store.js, do not raise the ceiling`);
  });
  if (c.inlineRoutes != null) {
    test(`${file} registers at most ${c.inlineRoutes} inline routes`, () => {
      const n = (src.match(/^\s*app\.(get|post|put|patch|delete|all)\(/gm) || []).length;
      assert.ok(n <= c.inlineRoutes, `${file} registers ${n} inline routes, ceiling ${c.inlineRoutes} — new routes go in routes/*.js`);
    });
  }
}
