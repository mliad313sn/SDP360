'use strict';
// F-ARCH-08 — strict coverage signal + criticality class for the generated inventory.
//
// The base inventory says a route is "referenced by a test" when a test file contains the path up to its
// first parameter. That is generous: `/api/reports/:id/helpdesk` is "referenced" by any file that contains
// `/api/reports`. The strict signal asks for more, and it is still only a signal (a mention, not a proof):
//   • route — a test file contains the WHOLE path, parameters filled in (a value, `${…}` or a `' + id`
//     concatenation), inside a string, ending where the route ends; a path that also fits a more specific
//     route (a literal segment where this one has a parameter) is credited to the more specific one; and for
//     a write (POST / PUT / PATCH / DELETE) the HTTP method is named near the path;
//   • job — the job name appears as a whole quoted string in a test file.
// Each route also gets criticality classes derived from what it declares (method, path, guards on its line):
//   access · finance · export · audit · destructive — plus write / read.
//
// Usage (through the inventory tool):
//   node tools/agent/inventory.js --strict            write docs/agent-execution/INVENTORY-STRICT.md
//   node tools/agent/inventory.js --strict --check    exit 1 if that file no longer matches the code
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT_MD = path.join(ROOT, 'docs', 'agent-execution', 'INVENTORY-STRICT.md');
const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function walk(dir, re, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== '__golden__' && e.name !== 'fixtures') walk(p, re, out); }
    else if (re.test(e.name)) out.push(p);
  }
  return out;
}
/** Every test source (unit, smoke, e2e specs, helpers): tests/**\/*.{js,mjs}. */
function testSources(root = ROOT) {
  return walk(path.join(root, 'tests'), /\.(js|mjs)$/).map((f) => ({ file: path.relative(root, f).split(path.sep).join('/'), src: read(f) }));
}

// A parameter as a test writes it: a value, a `${…}` template hole, or a closing quote + concatenation.
const PARAM = '(?:(?:\\$\\{[^}]*\\}|[^/\'"`\\s?#,)])+|[\'"`]\\s*\\+\\s*[\\w.$()\\[\\]]+(?:\\s*\\+\\s*[\'"`])?)';
const isDynamic = (p) => p.includes('${');
const segments = (p) => p.split('/').filter(Boolean);
const literalCount = (p) => segments(p).filter((s) => !/^[:*]/.test(s)).length;

/** Route path → regex matching it written in full inside a string of a test. */
function pathRegex(routePath) {
  const body = segments(routePath).map((s) => (/^:/.test(s) ? PARAM : s === '*' || /^\*/.test(s) ? '[^\'"`\\s]*' : esc(s))).join('/');
  // a page route (`/x.html`) is usually written as the bare file name in a page list
  if (/^\/[^/:*]+\.html$/.test(routePath)) return new RegExp('(?<=[\'"`}/\\s])' + body + '(?=[\'"`?#\\s,);]|$)', 'g');
  // starts right after a quote / backtick / template hole (`${base}/api/…`) or a space ('get /api/…');
  // ends at the end of the path
  return new RegExp('(?<=[\'"`}\\s])/' + body + '/?(?=[\'"`?#\\s,);]|$)', 'g');
}

const METHOD_NEAR = {
  POST: /\bpost\b/i, PUT: /\bput\b/i, PATCH: /\bpatch\b/i, DELETE: /\b(?:delete|del)\b/i,
};
/** Is the HTTP method named near position `i` (same call: a little before, a little after)? GET needs none. */
function methodNear(src, i, len, method) {
  const re = METHOD_NEAR[method];
  if (!re) return true;
  return re.test(src.slice(Math.max(0, i - 120), i)) || re.test(src.slice(i + len, i + len + 240));
}

/**
 * @param {Array<{id,method,path,file}>} routes
 * @param {Array<{file,src}>} tests
 * @returns {Map<string, string[]>} key `${id}@${file}` → sorted test files that reference the route strictly
 */
function strictRouteTests(routes, tests) {
  const usable = routes.filter((r) => !isDynamic(r.path)).map((r) => ({ r, re: pathRegex(r.path), lit: literalCount(r.path), pre: literalPrefixOf(r.path).replace(/^\/(?=[^/]+\.html$)/, '') }));
  const out = new Map(routes.map((r) => [r.id + '@' + r.file, new Set()]));
  for (const t of tests) {
    // position → candidates; the most specific path (most literal segments) wins that occurrence
    const at = new Map();
    for (const u of usable) {
      if (u.pre.length >= 4 && !t.src.includes(u.pre)) continue;
      u.re.lastIndex = 0;
      let m;
      while ((m = u.re.exec(t.src))) {
        const k = m.index + ':' + m[0].replace(/\/$/, '').length;
        if (!at.has(k)) at.set(k, []);
        at.get(k).push({ u, index: m.index, len: m[0].length });
        if (m[0].length === 0) u.re.lastIndex++;
      }
    }
    for (const cands of at.values()) {
      const best = Math.max(...cands.map((c) => c.u.lit));
      for (const c of cands) {
        if (c.u.lit !== best) continue;
        if (!methodNear(t.src, c.index, c.len, c.u.r.method)) continue;
        out.get(c.u.r.id + '@' + c.u.r.file).add(t.file);
      }
    }
  }
  return new Map([...out].map(([k, v]) => [k, [...v].sort()]));
}
function literalPrefixOf(p) { const i = p.search(/[:*(]/); return (i < 0 ? p : p.slice(0, i)).replace(/\/$/, ''); }

/** Job name as a whole quoted string. */
function strictJobTests(jobName, tests) {
  const re = new RegExp('[\'"`]' + esc(jobName) + '[\'"`]');
  return tests.filter((t) => re.test(t.src)).map((t) => t.file).sort();
}

// ---- criticality -------------------------------------------------------------------------------------
const CLASS_RULES = [
  ['access', /\/auth\b|\/users?\b|\/roles?\b|\/sessions?\b|\/access\b|\/sso\b|\/permissions?\b|\/grants?\b|\/password|\/api-keys?\b|\/delegat/i],
  ['finance', /financ|budget|\/cost|money|depreciation|investment|benefit|licen[cs]e|chargeback|\/sla\/config|capex|opex|forecast/i],
  ['export', /export|\.xlsx|\.csv|\.pdf|pptx|\/download|\/deck\b|workbook|\/send\b|\/publish|\/share\b|odata/i],
  ['audit', /audit|system-log|retention|evidence|\/chain\b|backup|restore|legal-hold|config-changes/i],
];
const DESTRUCTIVE_PATH = /\/delete\b|\/reset\b|\/purge\b|\/wipe\b|\/restore\b|\/revert\b|\/merge\b|force-logout/i;
/**
 * Classes of a route from what it declares. `guards` is the text of its declaring line (middleware names).
 * @returns {string[]} sorted, e.g. ['destructive','finance','write'] — 'read' alone for a plain GET.
 */
function classify(method, routePath, guards = '') {
  const out = new Set();
  for (const [name, re] of CLASS_RULES) if (re.test(routePath)) out.add(name);
  if (/requireFinance|requireMoney|finance-viewer/i.test(guards)) out.add('finance');
  if (/requireSuperAdmin|requireAuditViewer/.test(guards) && /log|audit/i.test(routePath)) out.add('audit');
  const write = method !== 'GET';
  if (method === 'DELETE' || (write && DESTRUCTIVE_PATH.test(routePath))) out.add('destructive');
  out.add(write ? 'write' : 'read');
  return [...out].sort();
}
const CRITICAL = new Set(['access', 'finance', 'export', 'audit', 'destructive']);
const isCritical = (classes) => classes.some((c) => CRITICAL.has(c));

/** inv = result of inventory.build(); returns the strict view. */
function buildStrict(inv, { root = ROOT, tests = null } = {}) {
  const T = tests || testSources(root);
  const map = strictRouteTests(inv.routes, T);
  const lineCache = new Map();
  const lineOf = (file, line) => {
    if (!lineCache.has(file)) { const p = path.join(root, file); lineCache.set(file, fs.existsSync(p) ? read(p).split('\n') : []); }
    return lineCache.get(file)[line - 1] || '';
  };
  const routes = inv.routes.map((r) => {
    const classes = classify(r.method, r.path, lineOf(r.file, r.line));
    return { id: r.id, method: r.method, path: r.path, file: r.file, line: r.line, dynamic: isDynamic(r.path), classes, critical: isCritical(classes), strict_tests: map.get(r.id + '@' + r.file) || [] };
  });
  const jobs = inv.jobs.map((j) => ({ id: j.id, job: j.job, strict_tests: strictJobTests(j.job, T) }));
  const measured = routes.filter((r) => !r.dynamic);
  const un = measured.filter((r) => r.strict_tests.length === 0);
  const summary = {
    routes: routes.length,
    routes_not_measurable: routes.length - measured.length,
    routes_without_strict_test: un.length,
    critical_routes: measured.filter((r) => r.critical).length,
    critical_routes_without_strict_test: un.filter((r) => r.critical).length,
    writes_without_strict_test: un.filter((r) => r.method !== 'GET').length,
    jobs: jobs.length,
    jobs_without_strict_test: jobs.filter((j) => j.strict_tests.length === 0).length,
    test_sources: T.length,
  };
  for (const c of CRITICAL) summary['without_strict_test_' + c] = un.filter((r) => r.classes.includes(c)).length;
  return { summary, routes, jobs };
}

function markdown(s) {
  const L = [];
  L.push('# Inventory — strict coverage signal and criticality (generated)', '',
    '`node tools/agent/inventory.js --strict` writes this file; `--strict --check` fails when the routes, jobs or classes changed.', '',
    'A route counts as **strictly referenced** when a test source (`tests/**/*.{js,mjs}`) contains its whole path with the parameters filled in, credited to the most specific matching route, and — for a write — names the HTTP method next to it. A job counts when its name is a whole quoted string in a test. This is a stricter **mention** signal than `INVENTORY.md`; it is not proof of correctness, and the two figures are expected to differ.', '',
    'Classes come from the declaration (method, path, guard names): `access`, `finance`, `export`, `audit`, `destructive` are the critical ones; `write` / `read` otherwise. A route whose path is built at run time is "not measurable" and is not counted as covered or uncovered.', '',
    '| Item | Count |', '|---|---:|');
  for (const [k, v] of Object.entries(s.summary)) L.push(`| ${k.replace(/_/g, ' ')} | ${v} |`);
  const un = s.routes.filter((r) => !r.dynamic && r.strict_tests.length === 0);
  const row = (r) => `| ${r.method} | \`${r.path}\` | ${r.classes.join(', ')} | ${r.file} |`;
  L.push('', '## Critical routes without a strict test reference', '', '| Method | Path | Classes | File |', '|---|---|---|---|');
  for (const r of un.filter((x) => x.critical)) L.push(row(r));
  L.push('', '## Other routes without a strict test reference', '', '| Method | Path | Classes | File |', '|---|---|---|---|');
  for (const r of un.filter((x) => !x.critical)) L.push(row(r));
  L.push('', '## Routes not measurable (path built at run time)', '', '| Method | Path | File |', '|---|---|---|');
  for (const r of s.routes.filter((x) => x.dynamic)) L.push(`| ${r.method} | \`${r.path}\` | ${r.file} |`);
  L.push('', '## Scheduled jobs without a strict test reference', '', '| Job |', '|---|');
  for (const j of s.jobs.filter((x) => x.strict_tests.length === 0)) L.push(`| ${j.job} |`);
  L.push('', '## Critical routes by class', '', '| Class | Routes | Without strict test |', '|---|---:|---:|');
  for (const c of CRITICAL) L.push(`| ${c} | ${s.routes.filter((r) => !r.dynamic && r.classes.includes(c)).length} | ${un.filter((r) => r.classes.includes(c)).length} |`);
  return L.join('\n') + '\n';
}

// What the check guards: which routes/jobs exist and their class. The lists of uncovered items move with
// every new test and are refreshed on regeneration (same policy as the base inventory).
function comparable(s) {
  return JSON.stringify({ routes: s.routes.map((r) => [r.method, r.path, r.file, r.classes.join('+')]).sort(), jobs: s.jobs.map((j) => j.job).sort() });
}
/** Recover the comparable part from a committed INVENTORY-STRICT.md is not possible — the check re-renders. */
function structureLine(s) { return '<!-- structure ' + require('crypto').createHash('sha256').update(comparable(s)).digest('hex').slice(0, 16) + ' -->'; }

function write(inv) { const s = buildStrict(inv); fs.writeFileSync(OUT_MD, markdown(s) + structureLine(s) + '\n'); return s; }
function check(inv) {
  if (!fs.existsSync(OUT_MD)) return { ok: false, reason: 'INVENTORY-STRICT.md missing — run node tools/agent/inventory.js --strict' };
  const s = buildStrict(inv);
  const ok = read(OUT_MD).includes(structureLine(s));
  return { ok, reason: ok ? '' : 'INVENTORY-STRICT.md is out of date — run node tools/agent/inventory.js --strict and commit', summary: s.summary };
}

module.exports = { OUT_MD, testSources, pathRegex, methodNear, strictRouteTests, strictJobTests, classify, isCritical, buildStrict, markdown, comparable, structureLine, write, check };
