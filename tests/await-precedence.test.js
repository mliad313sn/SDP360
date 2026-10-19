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
const DB_MODULES = ['reports-db.js', 'tracker-db.js', 'meetings-db.js', 'inspection-db.js', 'assets-db.js'];

// Files that consume the db modules. Directories are walked one level for .js.
// zoho-sync.js earned its place here on 2026-07-17 — see the MISSING-AWAIT test.
// assets-sync.js joined on 2026-07-17 with the Assets module wiring (Task 4).
const CALLER_FILES = ['server.js', 'zoho-sync.js', 'risk-register-export.js', 'assets-sync.js'];
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

// ── The MISSING-AWAIT scan ───────────────────────────────────────────────────
//
// The sibling of the chained-method bug, and FAR nastier: it doesn't crash.
//
//     const lastSync = getLastSyncAt(JOB);        // ← a Promise on postgres
//     ...
//     if (!lastSyncAt) return true;               // a Promise is TRUTHY
//     return isoDate > lastSyncAt;                // string > Promise → ALWAYS false
//
// That is `zoho-sync.js` before 2026-07-17. Every Zoho row was judged "not new",
// so the hourly sync fetched 25k rows, upserted ZERO, wrote markSyncSuccess and
// reported green. The dashboard silently froze on the day prod flipped to
// postgres; four sites lost 91-97% of their tickets and nothing logged an error.
// The chained-method scan above cannot see this — there's no `.method` to spot.
//
// Heuristic: a bare `foo(...)` statement, or `const x = foo(...)`, where foo is a
// dispatcher and there is no `await`/`return`/`.then`. Restricted to the assignment
// and bare-statement forms — that's where the damage is; passing a Promise straight
// into another call is rarer and would false-positive on legitimate composition.
function scanMissingAwait(src, dispatchers) {
  const hits = [];
  const lines = src.split('\n');
  lines.forEach((raw, i) => {
    const line = raw.replace(/\/\/.*$/, '');
    // `const x = foo(` / `let x = foo(` / bare `foo(` / plain reassignment `x = foo(`.
    // The reassignment form is NOT optional: `udfUpdated = upsertRequestUdfBatch(rows)`
    // (zoho-sync.js:687) slipped through a declaration-only pattern and shipped —
    // the logs read `dbUpdated=[object Promise]` for a day before anyone noticed.
    const m = line.match(/^\s*(?:(?:const|let|var)\s+)?(?:[\w${}[\],:\s.]+=\s*)?([a-zA-Z_$][\w$]*)\s*\(/);
    if (!m) return;
    const fn = m[1];
    if (!dispatchers.has(fn)) return;
    if (/\bawait\b|\breturn\b|\.then\b|\byield\b/.test(line)) return;   // handled
    // a ternary like `force ? null : getLastSyncAt(JOB)` — the await may precede
    if (/\bawait\s+[\w$]*\s*\?/.test(line)) return;
    hits.push({ line: i + 1, expr: line.trim().slice(0, 90) });
  });
  return hits;
}

test('the missing-await scan catches the zoho-sync shape', () => {
  const d = new Set(['getLastSyncAt', 'markSyncSuccess']);
  assert.strictEqual(scanMissingAwait('    const lastSync = getLastSyncAt(JOB);', d).length, 1);
  assert.strictEqual(scanMissingAwait('    markSyncSuccess(JOB, n, {});', d).length, 1, 'bare fire-and-forget statement');
  assert.strictEqual(scanMissingAwait('    const lastSync = await getLastSyncAt(JOB);', d).length, 0);
  assert.strictEqual(scanMissingAwait('    const lastSync = force ? null : await getLastSyncAt(JOB);', d).length, 0);
  assert.strictEqual(scanMissingAwait('    return getLastSyncAt(JOB);', d).length, 0, 'returning the Promise is fine');
  assert.strictEqual(scanMissingAwait('    // const lastSync = getLastSyncAt(JOB);', d).length, 0, 'comments are not code');
  // The one that got away: a plain reassignment, no declaration keyword.
  const d2 = new Set(['upsertRequestUdfBatch']);
  assert.strictEqual(scanMissingAwait('      udfUpdated = upsertRequestUdfBatch(udfRows);', d2).length, 1,
    'reassignment form — this exact line shipped and logged [object Promise]');
  assert.strictEqual(scanMissingAwait('      udfUpdated = await upsertRequestUdfBatch(udfRows);', d2).length, 0);
  assert.strictEqual(scanMissingAwait('      obj.count = upsertRequestUdfBatch(rows);', d2).length, 1, 'member assignment too');
});

test('NO caller drops the await on a dual-backend call (silent no-op on postgres)', () => {
  const dispatchers = findDispatchers();
  const bad = [];
  for (const file of callerFiles()) {
    for (const h of scanMissingAwait(fs.readFileSync(file, 'utf8'), dispatchers)) {
      bad.push(`${path.relative(ROOT, file)}:${h.line}  ${h.expr}`);
    }
  }
  assert.deepStrictEqual(bad, [], `\n\nmissing await — these return a Promise on postgres (prod) and DO NOT crash:\n\n` +
    bad.map(b => '  ' + b).join('\n') +
    `\n\nA Promise is truthy, and every comparison against it is false. The 2026-07-17\n` +
    `sync outage was exactly this. Add the await.\n`);
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
