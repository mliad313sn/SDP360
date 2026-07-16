'use strict';
// ── The await-precedence guard ───────────────────────────────────────────────
//
// WHY THIS EXISTS. Every dual-backend function in the *-db.js modules looks like:
//
//     function listReports(site_id, year, week) {
//       if (REPORTS_BACKEND === 'postgres') return _listReportsPg(...);   // ← a Promise
//       ...
//       return db.prepare(sql).all(...);                                  // ← an Array
//     }
//
// So `await rdb.listReports(id).find(...)` is a **prod-only crash**: on sqlite it
// returns an Array and `.find()` works; on postgres it returns a Promise and
// `.find` is not a function. `await` binds to the WHOLE expression, so it never
// gets the chance to unwrap. Correct form: `(await f()).method()`.
//
// This bit prod on 2026-07-16 — `POST /api/reports` (Open/Create Report) threw
// `rdb.listReports(...).find is not a function` for every admin, while the whole
// sqlite test suite stayed green. CLAUDE.md had documented the pitfall since the
// tracker sweep and it STILL shipped, because prose doesn't run in CI. This does.
//
// It's a static scan, not a runtime test: it needs no DB, no server, no PG, and
// it covers the callers the sqlite suite structurally CANNOT cover.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DB_MODULES = ['reports-db.js', 'tracker-db.js', 'meetings-db.js', 'inspection-db.js'];

// Files that consume the db modules. Directories are walked one level for .js.
const CALLER_FILES = ['server.js'];
const CALLER_DIRS  = ['routes', 'services', path.join('tools', 'reports')];

/** Names of functions that dispatch to a `_<name>Pg` fork — i.e. return a Promise on postgres. */
function findDispatchers() {
  const names = new Set();
  for (const f of DB_MODULES) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) continue;
    const src = fs.readFileSync(p, 'utf8');
    // function foo(...) {  [comments]  if (X_BACKEND === 'postgres') return _
    const re = /(?:async\s+)?function\s+([a-zA-Z_$][\w$]*)\s*\([^)]*\)\s*\{\s*(?:\/\/[^\n]*\n\s*)*if\s*\([A-Z_]+_BACKEND\s*===\s*'postgres'\)\s*return\s+_/g;
    let m;
    while ((m = re.exec(src))) names.add(m[1]);
  }
  return names;
}

function callerFiles() {
  const out = CALLER_FILES.map(f => path.join(ROOT, f)).filter(fs.existsSync);
  for (const d of CALLER_DIRS) {
    const dir = path.join(ROOT, d);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) if (f.endsWith('.js')) out.push(path.join(dir, f));
  }
  return out;
}

/**
 * Find `await <ns>.<dispatcher>( … ).<prop>` — the chained-onto-the-Promise form.
 * Balanced-paren scan, so nested calls in the arg list don't fool it.
 * The correct `(await f()).m()` form has `(` before `await` and is not matched.
 */
function scan(src, dispatchers) {
  const hits = [];
  const re = /await\s+([a-zA-Z_$][\w$]*)\.([a-zA-Z_$][\w$]*)\s*\(/g;
  let m;
  while ((m = re.exec(src))) {
    const [, ns, fn] = m;
    if (!dispatchers.has(fn)) continue;
    // walk to the matching close paren
    let i = re.lastIndex, depth = 1;
    while (i < src.length && depth > 0) {
      const c = src[i];
      if (c === '(') depth++;
      else if (c === ')') depth--;
      else if (c === '"' || c === "'" || c === '`') {           // skip strings
        const q = c; i++;
        while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++; }
      }
      i++;
    }
    if (depth !== 0) continue;
    if (src[i] === '.' && /[a-zA-Z_$]/.test(src[i + 1] || '')) {
      hits.push({ line: src.slice(0, m.index).split('\n').length, expr: `await ${ns}.${fn}(…).${src.slice(i + 1).match(/^[\w$]+/)[0]}` });
    }
  }
  return hits;
}

test('the dispatcher scan actually finds the dual-backend functions', () => {
  const d = findDispatchers();
  // Guard the guard: if a refactor changes the `if (X_BACKEND === 'postgres') return _fooPg(`
  // shape, this scan silently matches nothing and the whole test file passes vacuously.
  assert.ok(d.size > 50, `expected many dual-backend dispatchers, found ${d.size} — has the dispatch shape changed?`);
  assert.ok(d.has('listReports'), 'listReports is the canonical case — the scan must see it');
  assert.ok(d.has('loadTracker') && d.has('getMeeting') && d.has('listInspections'),
    'the scan must cover all four db modules, not just reports-db');
});

test('the scan catches the known-bad form and clears the correct one', () => {
  const d = new Set(['listReports']);
  assert.strictEqual(scan('const x = !await rdb.listReports(parseInt(id)).find(r => r.year === y);', d).length, 1,
    'must catch the exact prod bug (note the nested parseInt() call in the args)');
  assert.strictEqual(scan('const x = !(await rdb.listReports(parseInt(id))).find(r => r.year === y);', d).length, 0,
    'must NOT flag the correct (await f()).m() form');
  assert.strictEqual(scan('const rows = await rdb.listReports(id);', d).length, 0, 'a plain await is fine');
  assert.strictEqual(scan('await rdb.listReports(")." + a).find(x => x);', d).length, 1,
    'a paren/dot inside a string arg must not fool the scanner');
});

test('NO caller chains a method onto a dual-backend call (prod-only crash on postgres)', () => {
  const dispatchers = findDispatchers();
  const bad = [];
  for (const file of callerFiles()) {
    for (const h of scan(fs.readFileSync(file, 'utf8'), dispatchers)) {
      bad.push(`${path.relative(ROOT, file)}:${h.line}  ${h.expr}`);
    }
  }
  assert.deepStrictEqual(bad, [], `\n\nawait-precedence bug — these CRASH on postgres (prod) and pass on sqlite:\n\n` +
    bad.map(b => '  ' + b).join('\n') +
    `\n\nFix: (await f(...)).method()  —  the await must unwrap BEFORE the method call.\n`);
});
